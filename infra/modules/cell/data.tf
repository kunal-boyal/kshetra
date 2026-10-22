# The cell's data (spec 14.2): PostgreSQL with PostGIS, pg_partman and pg_trgm, and Redis-compatible
# Valkey for queues, rate limits and live positions. Both are encrypted and reachable only from
# the cell's tasks.

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.database_subnet_ids
  tags       = var.tags
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-postgres${var.db_engine_version}"
  family = "postgres${var.db_engine_version}"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Slow statements reach the logs (spec 14.6).
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  tags = var.tags
}

resource "aws_db_instance" "this" {
  identifier                            = var.name
  engine                                = "postgres"
  engine_version                        = var.db_engine_version
  instance_class                        = var.db_instance_class
  db_name                               = var.product_slug
  username                              = "postgres"
  manage_master_user_password           = true
  allocated_storage                     = var.db_storage_gb
  max_allocated_storage                 = var.db_max_storage_gb
  storage_type                          = "gp3"
  storage_encrypted                     = true
  multi_az                              = var.db_multi_az
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  vpc_security_group_ids                = [aws_security_group.database.id]
  parameter_group_name                  = aws_db_parameter_group.this.name
  backup_retention_period               = 14
  copy_tags_to_snapshot                 = true
  deletion_protection                   = true
  skip_final_snapshot                   = false
  final_snapshot_identifier             = "${var.name}-final"
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  auto_minor_version_upgrade            = true
  enabled_cloudwatch_logs_exports       = ["postgresql"]
  tags                                  = var.tags
}

resource "aws_db_instance" "replica" {
  count                        = var.db_replica ? 1 : 0
  identifier                   = "${var.name}-replica"
  replicate_source_db          = aws_db_instance.this.identifier
  instance_class               = var.db_instance_class
  storage_encrypted            = true
  vpc_security_group_ids       = [aws_security_group.database.id]
  parameter_group_name         = aws_db_parameter_group.this.name
  performance_insights_enabled = true
  skip_final_snapshot          = true
  tags                         = var.tags
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "Queues, rate limits and live positions for ${var.name}"
  engine                     = "valkey"
  engine_version             = "8.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.redis_nodes
  automatic_failover_enabled = var.redis_nodes > 1
  multi_az_enabled           = var.redis_nodes > 1
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  snapshot_retention_limit   = 1
  # BullMQ needs every key kept until its job is done.
  parameter_group_name = aws_elasticache_parameter_group.this.name
  tags                 = var.tags
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.name}-valkey8"
  family = "valkey8"
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
  tags = var.tags
}
