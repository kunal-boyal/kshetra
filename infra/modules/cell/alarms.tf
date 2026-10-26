# The alarms of spec 14.6 that infrastructure can see. Queue backlogs, OTP and notification
# failure rates and the location ingest rate need the app's own metrics, which come later.

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  lb = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  # Reports and exports read the replica (decision D98); a replica far behind shows stale figures.
  replica_alarms = var.db_replica ? {
    replica-lag = {
      description = "The read replica is more than a minute behind for 10 minutes"
      namespace   = "AWS/RDS"
      metric      = "ReplicaLag"
      statistic   = "Maximum"
      extended    = null
      threshold   = 60
      periods     = 10
      comparison  = "GreaterThanThreshold"
      dimensions  = { DBInstanceIdentifier = aws_db_instance.replica[0].identifier }
    }
  } : {}
  simple_alarms = merge(local.replica_alarms, {
    p95-latency = {
      description = "API p95 latency above 1 second for 10 minutes"
      namespace   = "AWS/ApplicationELB"
      metric      = "TargetResponseTime"
      statistic   = null
      extended    = "p95"
      threshold   = 1
      periods     = 10
      comparison  = "GreaterThanThreshold"
      dimensions  = local.lb
    }
    unhealthy-targets = {
      description = "An API task is failing its health check"
      namespace   = "AWS/ApplicationELB"
      metric      = "UnHealthyHostCount"
      statistic   = "Maximum"
      extended    = null
      threshold   = 0
      periods     = 5
      comparison  = "GreaterThanThreshold"
      dimensions  = local.lb
    }
    database-cpu = {
      description = "Database CPU above 80% for 15 minutes"
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      statistic   = "Average"
      extended    = null
      threshold   = 80
      periods     = 15
      comparison  = "GreaterThanThreshold"
      dimensions  = { DBInstanceIdentifier = aws_db_instance.this.identifier }
    }
    database-storage = {
      description = "Less than 10 GB of database storage left"
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      statistic   = "Minimum"
      extended    = null
      threshold   = 10 * 1024 * 1024 * 1024
      periods     = 5
      comparison  = "LessThanThreshold"
      dimensions  = { DBInstanceIdentifier = aws_db_instance.this.identifier }
    }
    database-connections = {
      description = "Database connections near the instance's limit"
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      statistic   = "Maximum"
      extended    = null
      threshold   = 300
      periods     = 5
      comparison  = "GreaterThanThreshold"
      dimensions  = { DBInstanceIdentifier = aws_db_instance.this.identifier }
    }
    redis-memory = {
      description = "Redis memory above 80%; queues stop taking jobs when it is full"
      namespace   = "AWS/ElastiCache"
      metric      = "DatabaseMemoryUsagePercentage"
      statistic   = "Maximum"
      extended    = null
      threshold   = 80
      periods     = 5
      comparison  = "GreaterThanThreshold"
      dimensions  = { ReplicationGroupId = aws_elasticache_replication_group.this.id }
    }
  })
}

resource "aws_cloudwatch_metric_alarm" "simple" {
  for_each            = local.simple_alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  extended_statistic  = each.value.extended
  period              = 60
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
  tags                = var.tags
}

# Server errors above 2% of requests for 5 minutes.
resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "${var.name}-5xx-rate"
  alarm_description   = "API 5xx responses above 2% for 5 minutes"
  evaluation_periods  = 5
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "rate"
    expression  = "IF(requests > 0, 100 * errors / requests, 0)"
    label       = "5xx rate (%)"
    return_data = true
  }
  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = local.lb
      period      = 60
      stat        = "Sum"
    }
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = local.lb
      period      = 60
      stat        = "Sum"
    }
  }
  tags = var.tags
}
