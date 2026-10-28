# The cell's processes on ECS Fargate (spec 14.2), all from one image: the API behind the load
# balancer, the worker, one scheduler, and the one-off migrate and bootstrap tasks. Settings are
# plain environment variables; secrets come from one Secrets Manager secret, key by key.
#
# Deploys (.github/workflows/deploy.yml) register new revisions with the new image and point the
# services at them, so Terraform leaves the services' task definitions alone once created. After
# changing settings here, run the deploy again for the current commit to roll them out.

data "aws_region" "current" {}

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.name}/app"
  description = "The cell's secrets, one key per setting; see docs/runbooks/deploy.md"
  tags        = var.tags
}

# CloudFront's X-Origin-Verify value, kept as a secret of its own so nobody copies it by hand; the
# API believes the viewer's address CloudFront passes on only with it (decision D101).
resource "aws_secretsmanager_secret" "origin" {
  count       = var.origin_secret == null ? 0 : 1
  name        = "${var.name}/origin"
  description = "The X-Origin-Verify value CloudFront sends to this cell"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "origin" {
  count         = var.origin_secret == null ? 0 : 1
  secret_id     = aws_secretsmanager_secret.origin[0].id
  secret_string = var.origin_secret
}

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}

resource "aws_cloudwatch_log_group" "process" {
  for_each          = toset(["api", "worker", "scheduler", "migrate", "bootstrap"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
  tags              = var.tags
}

data "aws_caller_identity" "current" {}

# The cell's logs, security events among them, are encrypted under a key of their own (ASVS
# V16.4.2, decision D101): CloudWatch Logs may use it only for this cell's log groups, and the
# processes, which only write to standard output, never hold it.
resource "aws_kms_key" "logs" {
  description             = "${var.name} logs"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.logs_key.json
  tags                    = var.tags
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${var.name}-logs"
  target_key_id = aws_kms_key.logs.key_id
}

data "aws_iam_policy_document" "logs_key" {
  # The account administers the key, as every key policy must allow.
  statement {
    sid       = "Account"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "CellLogGroups"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${data.aws_region.current.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/${var.name}/*",
        "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:aws-waf-logs-${var.name}",
      ]
    }
  }
}

data "aws_iam_policy_document" "ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ECS itself: pulls the image, writes logs and reads the secret.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secret" {
  name = "secret"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = concat(
        [aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.redis.arn],
        aws_secretsmanager_secret.origin[*].arn,
      )
    }]
  })
}

# The app: the media bucket, and nothing else of AWS's.
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "task_media" {
  name = "media"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:PutObjectTagging"]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.media.arn },
      # Files are encrypted under the media key; uploads by presigned link use the task's rights.
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.media.arn
      },
    ]
  })
}

locals {
  environment = merge(
    {
      NODE_ENV     = "production"
      PRODUCT_SLUG = var.product_slug
      PRODUCT_NAME = var.product_name
      HOST         = "0.0.0.0"
      PORT         = "3000"
      # The load balancer is the one proxy believed (decision D101).
      TRUST_PROXY       = "1"
      CELL_ID           = var.cell_id
      CELL_API_URL      = "https://${var.cell_domain}"
      CELL_REGION       = data.aws_region.current.region
      REDIS_URL         = "rediss://${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
      OBJECT_STORE      = "s3"
      S3_BUCKET         = aws_s3_bucket.media.bucket
      S3_REGION         = data.aws_region.current.region
      CLOUDFRONT_DOMAIN = coalesce(var.media_domain, aws_cloudfront_distribution.media.domain_name)
      CLOUDFRONT_KEY_ID = aws_cloudfront_public_key.media.id
      OTP_PROVIDER      = "msg91"
      SMS_PROVIDER      = "msg91"
      PUSH_PROVIDER     = "expo"
      EMAIL_PROVIDER    = "smtp"
      # Off until a WhatsApp provider account exists (decisions D12, D85); deliveries skip to SMS.
      WHATSAPP_PROVIDER = "off"
      # Off until the Razorpay account exists (decision D90): invoices are paid by transfer and
      # recorded in the console.
      PAYMENT_PROVIDER = "off"
      # The scheduler's minute of health becomes CloudWatch metrics for the alarms, and error
      # reports name the environment once a SENTRY_DSN is set in `environment` (decision D98).
      CLOUDWATCH_METRICS = "true"
      SENTRY_ENVIRONMENT = var.name
    },
    { WEB_URL = var.web_url },
    var.console_url == null ? {} : { CONSOLE_URL = var.console_url },
    # Reports, exports and API clients' list reads go to the replica (decision D98), as the same
    # role as DATABASE_URL.
    var.db_replica ? { DATABASE_REPLICA_HOST = aws_db_instance.replica[0].address } : {},
    var.environment,
  )
  secret = aws_secretsmanager_secret.app.arn
  # Which keys of the cell's secret each process reads (decision D101), as `ROLE_SECRETS` in
  # apps/api/src/config.ts: the API all of them; the worker all but the API's pepper and token
  # keys; the scheduler, which only adds jobs and reports health, the databases alone.
  api_only_secrets  = ["OTP_PEPPER", "JWT_SIGNING_KEY", "JWT_PUBLISHED_KEYS"]
  worker_secrets    = [for key in var.secret_keys : key if !contains(local.api_only_secrets, key)]
  scheduler_secrets = ["DATABASE_URL", "DIRECTORY_DATABASE_URL"]
  processes = {
    api = {
      command     = ["node", "dist/main.mjs"]
      cpu         = var.api.cpu
      memory      = var.api.memory
      environment = merge(local.environment, { PROCESS_ROLE = "api" })
      secrets     = var.secret_keys
    }
    worker = {
      command     = ["node", "dist/worker.mjs"]
      cpu         = var.worker.cpu
      memory      = var.worker.memory
      environment = merge(local.environment, { OUTBOX_RELAY = "true", PROCESS_ROLE = "worker" })
      secrets     = local.worker_secrets
    }
    scheduler = {
      command     = ["node", "dist/scheduler.mjs"]
      cpu         = var.scheduler.cpu
      memory      = var.scheduler.memory
      environment = merge(local.environment, { PROCESS_ROLE = "scheduler" })
      secrets     = local.scheduler_secrets
    }
    # Runs before every deploy; only the migrator's URL.
    migrate = {
      command     = ["node", "dist/migrate.mjs"]
      cpu         = 256
      memory      = 512
      environment = { NODE_ENV = "production" }
      secrets     = ["DATABASE_MIGRATOR_URL"]
    }
    # Runs once, when the cell is new: the roles and extensions (docs/runbooks/deploy.md).
    bootstrap = {
      command = ["node", "dist/bootstrap.mjs"]
      cpu     = 256
      memory  = 512
      environment = {
        NODE_ENV               = "production"
        BOOTSTRAP_CONFIRM_HOST = aws_db_instance.this.address
      }
      secrets = ["DATABASE_BOOTSTRAP_URL", "DATABASE_MIGRATOR_URL", "DATABASE_URL", "DIRECTORY_DATABASE_URL"]
    }
  }
}

resource "aws_ecs_task_definition" "process" {
  for_each                 = local.processes
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = each.key
    image        = var.image
    essential    = true
    command      = each.value.command
    portMappings = each.key == "api" ? [{ containerPort = 3000, protocol = "tcp" }] : []
    environment  = [for key, value in each.value.environment : { name = key, value = value }]
    secrets = concat(
      [for key in each.value.secrets : { name = key, valueFrom = "${local.secret}:${key}::" }],
      contains(["api", "worker", "scheduler"], each.key)
      ? [{ name = "REDIS_PASSWORD", valueFrom = aws_secretsmanager_secret.redis.arn }]
      : [],
      each.key == "api" && var.origin_secret != null
      ? [{ name = "ORIGIN_SECRET", valueFrom = aws_secretsmanager_secret.origin[0].arn }]
      : [],
    )
    stopTimeout = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.process[each.key].name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
  tags = var.tags
}

locals {
  services = {
    api    = { count = var.api.count, min = 100, max = 200 }
    worker = { count = var.worker.count, min = 100, max = 200 }
    # One scheduler at a time: the old task stops before the new one starts.
    scheduler = { count = 1, min = 0, max = 100 }
  }
}

resource "aws_ecs_service" "process" {
  for_each                           = local.services
  name                               = each.key
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.process[each.key].arn
  desired_count                      = each.value.count
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = each.value.min
  deployment_maximum_percent         = each.value.max
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"
  health_check_grace_period_seconds  = each.key == "api" ? 30 : null

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = each.key == "api" ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.api.arn
      container_name   = "api"
      container_port   = 3000
    }
  }

  lifecycle {
    # Deploys own the running revision; autoscaling owns the API's count.
    ignore_changes = [task_definition, desired_count]
  }
  depends_on = [aws_lb_listener.https]
  tags       = var.tags
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.process["api"].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api.count
  max_capacity       = var.api.max_count
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name}-api-cpu"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${var.name}-api-requests"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value = 1000
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.this.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}
