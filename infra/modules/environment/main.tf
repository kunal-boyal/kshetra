# One environment (spec 14.1): its network, image repository, certificates, one cell, the web
# portal and the role GitHub deploys with. The directory plane runs inside the cell's API until
# a second cell exists (phases 0 to 2, decision D23), so its tables share the cell's database.

locals {
  tags = merge({ Product = "thelamp", Environment = var.github_environment }, var.tags)
}

module "network" {
  source              = "../network"
  name                = var.name
  cidr                = var.vpc_cidr
  zones               = var.zones
  nat_per_zone        = var.cell.nat_per_zone
  interface_endpoints = var.cell.endpoints
  tags                = local.tags
}

module "ecr" {
  source = "../ecr"
  name   = "${var.name}-api"
  tags   = local.tags
}

# The API's certificate lives in the cell's region; CloudFront's in us-east-1.
resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"
  tags              = local.tags
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "edge" {
  provider                  = aws.us_east_1
  domain_name               = var.web_domain
  subject_alternative_names = compact([var.media_domain, var.console_domain])
  validation_method         = "DNS"
  tags                      = local.tags
  lifecycle {
    create_before_destroy = true
  }
}

locals {
  validation_records = {
    for option in concat(
      tolist(aws_acm_certificate.api.domain_validation_options),
      tolist(aws_acm_certificate.edge.domain_validation_options),
    ) : option.domain_name => option...
  }
}

resource "aws_route53_record" "validation" {
  for_each        = var.route53_zone_id == null ? {} : local.validation_records
  zone_id         = var.route53_zone_id
  name            = each.value[0].resource_record_name
  type            = each.value[0].resource_record_type
  records         = [each.value[0].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
  validation_record_fqdns = (
    var.route53_zone_id == null ? null : [for record in aws_route53_record.validation : record.fqdn]
  )
}

resource "aws_acm_certificate_validation" "edge" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.edge.arn
  validation_record_fqdns = (
    var.route53_zone_id == null ? null : [for record in aws_route53_record.validation : record.fqdn]
  )
}

# CloudFront proves a request came through it with this header, so the cell's WAF throttles only
# what comes straight to it, and CloudFront's WAF the rest, per viewer (decision D98). Made once:
# the random password would change every plan, so its first value is kept.
data "aws_secretsmanager_random_password" "origin" {
  password_length     = 40
  exclude_punctuation = true
}

resource "terraform_data" "origin_secret" {
  input = data.aws_secretsmanager_random_password.origin.random_password
  lifecycle {
    ignore_changes = [input]
  }
}

module "cell" {
  source                       = "../cell"
  name                         = "${var.name}-${var.cell.id}"
  cell_id                      = var.cell.id
  vpc_id                       = module.network.vpc_id
  vpc_cidr                     = module.network.cidr
  public_subnet_ids            = module.network.public_subnet_ids
  private_subnet_ids           = module.network.private_subnet_ids
  database_subnet_ids          = module.network.database_subnet_ids
  image                        = "${module.ecr.repository_url}:${var.initial_image_tag}"
  api_domain                   = var.api_domain
  certificate_arn              = aws_acm_certificate_validation.api.certificate_arn
  media_domain                 = var.media_domain
  web_url                      = "https://${var.web_domain}"
  console_url                  = var.console_domain == null ? null : "https://${var.console_domain}"
  media_domain_certificate_arn = var.media_domain == null ? null : aws_acm_certificate_validation.edge.certificate_arn
  media_public_key_pem         = var.media_public_key_pem
  db_instance_class            = var.cell.db_instance_class
  db_multi_az                  = var.cell.db_multi_az
  db_replica                   = var.cell.db_replica
  redis_node_type              = var.cell.redis_node_type
  redis_nodes                  = var.cell.redis_nodes
  api                          = var.cell.api
  worker                       = var.cell.worker
  environment                  = var.environment
  secret_keys = concat([
    "DATABASE_URL",
    "DIRECTORY_DATABASE_URL",
    "OTP_PEPPER",
    "COLUMN_KEY",
    "ARCHIVE_SIGNING_KEY",
    "JWT_SIGNING_KEY",
    "CLOUDFRONT_PRIVATE_KEY",
    "MSG91_AUTH_KEY",
    "SMTP_URL",
  ], var.extra_secret_keys)
  origin_secret = sensitive(terraform_data.origin_secret.output)
  alarm_email   = var.alarm_email
  tags          = local.tags
}

module "web" {
  source = "../web"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name            = var.name
  domain          = var.web_domain
  certificate_arn = aws_acm_certificate_validation.edge.certificate_arn
  api_domain      = var.api_domain
  origin_secret   = sensitive(terraform_data.origin_secret.output)
  maps            = true
  media_origin    = "https://${coalesce(var.media_domain, module.cell.media_distribution_domain)}"
  tags            = local.tags
}

# The platform console (decision D88): the same kind of site, passing /platform to the cell.
module "console" {
  count  = var.console_domain == null ? 0 : 1
  source = "../web"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name            = "${var.name}-console"
  domain          = var.console_domain
  certificate_arn = aws_acm_certificate_validation.edge.certificate_arn
  api_domain      = var.api_domain
  api_paths       = ["/platform/*"]
  origin_secret   = sensitive(terraform_data.origin_secret.output)
  tags            = local.tags
}

module "deploy" {
  source                   = "../github-deploy"
  name                     = "${var.name}-deploy"
  repository               = var.repository
  github_environment       = var.github_environment
  create_oidc_provider     = var.create_oidc_provider
  ecr_repository_arn       = module.ecr.repository_arn
  cluster_arn              = module.cell.cluster_arn
  task_role_arns           = module.cell.task_role_arns
  web_bucket_arn           = module.web.bucket_arn
  web_distribution_arn     = module.web.distribution_arn
  console_bucket_arn       = one(module.console[*].bucket_arn)
  console_distribution_arn = one(module.console[*].distribution_arn)
  tags                     = local.tags
}

# Where the domains point, when Route 53 holds them.
resource "aws_route53_record" "api" {
  count   = var.route53_zone_id == null ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.api_domain
  type    = "A"
  alias {
    name                   = module.cell.load_balancer_dns_name
    zone_id                = module.cell.load_balancer_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "web" {
  count   = var.route53_zone_id == null ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.web_domain
  type    = "CNAME"
  ttl     = 300
  records = [module.web.distribution_domain]
}

resource "aws_route53_record" "console" {
  count   = var.route53_zone_id != null && var.console_domain != null ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.console_domain
  type    = "CNAME"
  ttl     = 300
  records = [module.console[0].distribution_domain]
}

resource "aws_route53_record" "media" {
  count   = var.route53_zone_id != null && var.media_domain != null ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.media_domain
  type    = "CNAME"
  ttl     = 300
  records = [module.cell.media_distribution_domain]
}
