output "load_balancer_dns_name" {
  description = "Point the directory's name and cell_domain here (CNAMEs, or alias records in Route 53)."
  value       = aws_lb.this.dns_name
}

output "load_balancer_zone_id" {
  value = aws_lb.this.zone_id
}

output "load_balancer_arn" {
  value = aws_lb.this.arn
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "task_families" {
  description = "Task definition families by process: api, worker, scheduler, migrate, bootstrap."
  value       = { for key, definition in aws_ecs_task_definition.process : key => definition.family }
}

output "task_role_arns" {
  value = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
}

output "task_subnet_ids" {
  value = var.private_subnet_ids
}

output "task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "secret_arn" {
  description = "Set its value before the first deploy: one key per setting (docs/runbooks/deploy.md)."
  value       = aws_secretsmanager_secret.app.arn
}

output "database_address" {
  value = aws_db_instance.this.address
}

output "database_name" {
  value = aws_db_instance.this.db_name
}

output "database_master_secret_arn" {
  description = "RDS keeps the master user's password here; bootstrap's URL uses it."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "media_distribution_domain" {
  description = "Point media_domain here, when one is set."
  value       = aws_cloudfront_distribution.media.domain_name
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

# The one-off tasks' logs, which a deploy may read when a migration fails.
output "one_off_log_group_arns" {
  value = [for key in ["migrate", "bootstrap"] : aws_cloudwatch_log_group.process[key].arn]
}
