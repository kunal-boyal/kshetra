variable "name" {
  description = "Prefix for every resource's name, such as thelamp-staging-cell1."
  type        = string
}

variable "cell_id" {
  description = "The cell's ID, as access tokens name it (CELL_ID)."
  type        = string
}

variable "product_slug" {
  description = "PRODUCT_SLUG; every identifier derives from it (spec 0)."
  type        = string
  default     = "thelamp"
}

variable "product_name" {
  description = "PRODUCT_NAME, where people read it (decision D1)."
  type        = string
  default     = "The Lamp"
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "database_subnet_ids" {
  type = list(string)
}

variable "image" {
  description = "The API image to start with, as repository:tag. Deploys register new revisions themselves; Terraform ignores the image after creation."
  type        = string
}

variable "api_domain" {
  description = "Where apps reach the cell, such as api.example.com (CELL_API_URL)."
  type        = string
}

variable "certificate_arn" {
  description = "The ACM certificate for api_domain, in the cell's region."
  type        = string
}

variable "media_domain_certificate_arn" {
  description = "An ACM certificate in us-east-1 for media_domain; null serves media on CloudFront's own domain."
  type        = string
  default     = null
}

variable "media_domain" {
  description = "A domain for photos and files, such as media.example.com; null uses CloudFront's own."
  type        = string
  default     = null
}

variable "media_public_key_pem" {
  description = "The public half of the key that signs media URLs; its private half goes in the cell's secret as CLOUDFRONT_PRIVATE_KEY."
  type        = string
}

# Sizes. The defaults are the lean pilot cell (decision D67); a production cell raises them.

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_engine_version" {
  description = "PostgreSQL's major version; RDS picks its current minor."
  type        = string
  default     = "18"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_replica" {
  description = "A read replica for reports and exports."
  type        = bool
  default     = false
}

variable "db_storage_gb" {
  type    = number
  default = 50
}

variable "db_max_storage_gb" {
  type    = number
  default = 500
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "redis_nodes" {
  description = "1 for a lean cell; 2 or more add a replica and automatic failover."
  type        = number
  default     = 1
}

variable "api" {
  description = "The API service: tasks, the most autoscaling may add, and each task's size."
  type = object({
    count     = number
    max_count = number
    cpu       = number
    memory    = number
  })
  default = { count = 1, max_count = 4, cpu = 512, memory = 1024 }
}

variable "worker" {
  type = object({
    count  = number
    cpu    = number
    memory = number
  })
  default = { count = 1, cpu = 512, memory = 1024 }
}

variable "scheduler" {
  type = object({
    cpu    = number
    memory = number
  })
  default = { cpu = 256, memory = 512 }
}

variable "environment" {
  description = "Settings every process gets beyond the ones this module sets, such as MSG91_OTP_TEMPLATE_ID or MIN_ANDROID_VERSION."
  type        = map(string)
  default     = {}
}

variable "secret_keys" {
  description = "Keys of the cell's secret each process reads as a setting. Set the secret's value before the first deploy (docs/runbooks/deploy.md)."
  type        = list(string)
  default = [
    "DATABASE_URL",
    "DIRECTORY_DATABASE_URL",
    "OTP_PEPPER",
    "JWT_SIGNING_KEY",
    "CLOUDFRONT_PRIVATE_KEY",
    "MSG91_AUTH_KEY",
    "SMTP_URL",
  ]
}

variable "alarm_email" {
  description = "Where alarms go; null keeps them on the SNS topic only."
  type        = string
  default     = null
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
