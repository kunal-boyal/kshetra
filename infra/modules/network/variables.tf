variable "name" {
  description = "Prefix for every resource's name, such as thelamp-staging."
  type        = string
}

variable "cidr" {
  description = "The VPC's address range; each of the two zones takes a /20 per tier."
  type        = string
  default     = "10.40.0.0/16"
}

variable "zones" {
  description = "Two availability zones in the region."
  type        = list(string)
  validation {
    condition     = length(var.zones) == 2
    error_message = "A cell spans exactly two availability zones (spec 14.2)."
  }
}

variable "nat_per_zone" {
  description = "One NAT gateway per zone; a lean pilot cell shares one."
  type        = bool
  default     = false
}

variable "interface_endpoints" {
  description = "Private endpoints for ECR, Secrets Manager and CloudWatch Logs, so tasks reach them without the NAT gateway. Worth it once traffic grows; a lean cell goes through NAT."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
