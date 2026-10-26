# The role GitHub Actions takes to deploy (spec 14.3), by OpenID Connect: no AWS keys are stored in
# GitHub. Only the main branch of the one repository, in the named GitHub environment, may take it.

variable "name" {
  description = "The role's name, such as thelamp-staging-deploy."
  type        = string
}

variable "repository" {
  description = "The GitHub repository, as owner/name."
  type        = string
}

variable "github_environment" {
  description = "The GitHub environment whose jobs may deploy, such as staging."
  type        = string
}

variable "create_oidc_provider" {
  description = "An account holds GitHub's OIDC provider once; the first environment in it creates it."
  type        = bool
  default     = true
}

variable "ecr_repository_arn" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "task_role_arns" {
  description = "The roles the deploy passes to ECS tasks: the execution role and the task role."
  type        = list(string)
}

variable "web_bucket_arn" {
  type = string
}

variable "web_distribution_arn" {
  type = string
}

variable "console_bucket_arn" {
  description = "The platform console's bucket, when it has one (decision D88)."
  type        = string
  default     = null
}

variable "console_distribution_arn" {
  type    = string
  default = null
}

variable "log_group_arns" {
  type        = list(string)
  description = "The log groups a deploy may read: the cell's migrate and bootstrap tasks'"
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
}

locals {
  provider_arn = (
    var.create_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
  )
}

resource "aws_iam_role" "deploy" {
  name = var.name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.repository}:environment:${var.github_environment}"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
          "ecr:DescribeImages", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
        ]
        Resource = var.ecr_repository_arn
      },
      {
        # Task definitions have no resource-level permissions for these actions.
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
        Resource = "*"
      },
      {
        Effect    = "Allow"
        Action    = ["ecs:DescribeServices", "ecs:UpdateService", "ecs:RunTask", "ecs:DescribeTasks"]
        Resource  = "*"
        Condition = { ArnEquals = { "ecs:cluster" = var.cluster_arn } }
      },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = var.task_role_arns },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = compact([var.web_bucket_arn, var.console_bucket_arn])
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
        Resource = [for arn in compact([var.web_bucket_arn, var.console_bucket_arn]) : "${arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = compact([var.web_distribution_arn, var.console_distribution_arn])
      },
      {
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
        Resource = flatten([for arn in var.log_group_arns : [arn, "${arn}:*"]])
      },
      { Effect = "Allow", Action = ["cloudwatch:DescribeAlarms"], Resource = "*" },
    ]
  })
}

output "role_arn" {
  value = aws_iam_role.deploy.arn
}
