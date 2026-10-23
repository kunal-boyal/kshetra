variable "name" {
  description = "The environment's prefix, such as thelamp-staging."
  type        = string
}

variable "github_environment" {
  description = "The GitHub environment that deploys here, such as staging or production."
  type        = string
}

variable "repository" {
  description = "The GitHub repository that deploys, as owner/name."
  type        = string
  default     = "kunal-boyal/kshetra"
}

variable "create_oidc_provider" {
  type    = bool
  default = true
}

variable "zones" {
  type    = list(string)
  default = ["ap-south-1a", "ap-south-1b"]
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "api_domain" {
  description = "Where apps reach the cell, such as api.example.com."
  type        = string
}

variable "web_domain" {
  description = "The web portal, such as app.example.com."
  type        = string
}

variable "media_domain" {
  description = "Photos and files, such as media.example.com; null uses CloudFront's own domain."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "The Route 53 zone of the domains; null means the DNS records are added by hand from the outputs."
  type        = string
  default     = null
}

variable "media_public_key_pem" {
  type = string
}

variable "initial_image_tag" {
  description = "The image tag the services start with; deploys move them on."
  type        = string
  default     = "bootstrap"
}

variable "cell" {
  description = "The cell's sizes and settings; see modules/cell/variables.tf."
  type = object({
    id                = string
    db_instance_class = optional(string, "db.t4g.medium")
    db_multi_az       = optional(bool, false)
    db_replica        = optional(bool, false)
    redis_node_type   = optional(string, "cache.t4g.small")
    redis_nodes       = optional(number, 1)
    api               = optional(object({ count = number, max_count = number, cpu = number, memory = number }), { count = 1, max_count = 4, cpu = 512, memory = 1024 })
    worker            = optional(object({ count = number, cpu = number, memory = number }), { count = 1, cpu = 512, memory = 1024 })
    nat_per_zone      = optional(bool, false)
    endpoints         = optional(bool, false)
  })
}

variable "environment" {
  description = "Settings for every process, such as MSG91_OTP_TEMPLATE_ID, MSG91_SENDER, MAIL_FROM or MIN_APP_VERSION_ANDROID."
  type        = map(string)
  default     = {}
}

variable "extra_secret_keys" {
  description = "Secret keys beyond the cell's defaults, such as EXPO_ACCESS_TOKEN."
  type        = list(string)
  default     = []
}

variable "alarm_email" {
  type    = string
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
