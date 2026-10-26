# Who may talk to whom: the internet to the load balancer, the load balancer to the API, the tasks
# to the database and Redis, and nothing else in.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "HTTPS from anywhere"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "The cell's ECS tasks"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

# Out only as the cell needs (decision D101): HTTPS to AWS's APIs, the providers (MSG91, Expo,
# Firebase, Sentry) and tenants' webhooks and identity providers, SMTP over TLS to SES, and the
# database and Redis in their own groups. DNS goes to the VPC's resolver, which no group filters.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  for_each          = { ipv4 = "0.0.0.0/0", ipv6 = "::/0" }
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = each.key == "ipv4" ? each.value : null
  cidr_ipv6         = each.key == "ipv6" ? each.value : null
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "tasks_smtp" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 465
  to_port           = 465
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "tasks_database" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "tasks_redis" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "PostgreSQL from the cell's tasks"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "database_from_tasks" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis from the cell's tasks"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_tasks" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}
