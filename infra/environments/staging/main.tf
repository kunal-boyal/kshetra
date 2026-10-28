# The staging environment (spec 14.1), in its own AWS account. Its state lives in an S3 bucket in
# that account, named at init: terraform init -backend-config=backend.hcl (see
# docs/runbooks/deploy.md, and backend.hcl.example beside this file).

terraform {
  required_version = ">= 1.14"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  backend "s3" {
    key          = "staging/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = { Product = "thelamp", Environment = "staging", ManagedBy = "terraform" }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Product = "thelamp", Environment = "staging", ManagedBy = "terraform" }
  }
}

variable "api_domain" {
  description = "The directory's name, which never changes (decision D105)."
  type        = string
}

variable "cell_domain" {
  description = "The first cell's own name, such as in1.api.example.com (decision D105)."
  type        = string
}

variable "web_domain" {
  type = string
}

variable "console_domain" {
  type    = string
  default = null
}

variable "media_domain" {
  type    = string
  default = null
}

variable "route53_zone_id" {
  type    = string
  default = null
}

variable "media_public_key_pem" {
  description = "The public half of the media signing key; the private half goes in the cell's secret."
  type        = string
}

variable "alarm_email" {
  type    = string
  default = null
}

variable "environment" {
  description = "Settings such as MSG91_OTP_TEMPLATE_ID, MSG91_SENDER, MSG91_SMS_TEMPLATES and MAIL_FROM."
  type        = map(string)
  default     = {}
}

module "environment" {
  source = "../../modules/environment"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name                 = "thelamp-staging"
  github_environment   = "staging"
  api_domain           = var.api_domain
  cell_domain          = var.cell_domain
  web_domain           = var.web_domain
  media_domain         = var.media_domain
  console_domain       = var.console_domain
  route53_zone_id      = var.route53_zone_id
  media_public_key_pem = var.media_public_key_pem
  alarm_email          = var.alarm_email
  environment          = var.environment
  # Lean: the pilot cell's sizes (decision D67).
  cell = { id = "cell1" }
}

output "github_variables" {
  value = module.environment.github_variables
}

output "dns_records" {
  value = module.environment.dns_records
}

output "secret_arn" {
  value = module.environment.secret_arn
}

output "database_address" {
  value = module.environment.database_address
}

output "database_name" {
  value = module.environment.database_name
}

output "database_master_secret_arn" {
  value = module.environment.database_master_secret_arn
}
