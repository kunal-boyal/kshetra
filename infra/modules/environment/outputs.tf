output "github_variables" {
  description = "The deploy workflow's settings: add them to the GitHub environment as variables (docs/runbooks/deploy.md)."
  value = {
    AWS_REGION          = data.aws_region.current.region
    AWS_DEPLOY_ROLE_ARN = module.deploy.role_arn
    ECR_REPOSITORY_URL  = module.ecr.repository_url
    ECS_CLUSTER         = module.cell.cluster_name
    TASK_FAMILY_PREFIX  = "${var.name}-${var.cell.id}"
    TASK_SUBNETS        = join(",", module.cell.task_subnet_ids)
    TASK_SECURITY_GROUP = module.cell.task_security_group_id
    WEB_BUCKET          = module.web.bucket
    WEB_DISTRIBUTION_ID = module.web.distribution_id
    # Empty until the console has a domain (decision D88); the deploy then leaves it out.
    CONSOLE_BUCKET          = one(module.console[*].bucket) == null ? "" : one(module.console[*].bucket)
    CONSOLE_DISTRIBUTION_ID = one(module.console[*].distribution_id) == null ? "" : one(module.console[*].distribution_id)
  }
}

output "dns_records" {
  description = "Without a Route 53 zone, add these by hand: certificate validation first, then the domains."
  value = var.route53_zone_id != null ? {} : {
    validation = {
      for domain, options in local.validation_records :
      options[0].resource_record_name => "${options[0].resource_record_type} ${options[0].resource_record_value}"
    }
    domains = merge(
      { (var.api_domain) = "CNAME ${module.cell.load_balancer_dns_name}" },
      { (var.cell_domain) = "CNAME ${module.cell.load_balancer_dns_name}" },
      { (var.web_domain) = "CNAME ${module.web.distribution_domain}" },
      var.media_domain == null ? {} : { (var.media_domain) = "CNAME ${module.cell.media_distribution_domain}" },
      var.console_domain == null ? {} : { (var.console_domain) = "CNAME ${module.console[0].distribution_domain}" },
    )
  }
}

output "secret_arn" {
  value = module.cell.secret_arn
}

output "database_address" {
  value = module.cell.database_address
}

output "database_name" {
  value = module.cell.database_name
}

output "database_master_secret_arn" {
  value = module.cell.database_master_secret_arn
}

output "alarm_topic_arn" {
  value = module.cell.alarm_topic_arn
}

data "aws_region" "current" {}
