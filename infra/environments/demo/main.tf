# The demo (decision D70): the whole product on one small EC2 instance in Kunal's AWS sandbox,
# kept within the Free plan's credit. Docker Compose runs PostgreSQL, Redis, the API, worker and
# scheduler, and Caddy, which serves the web portal and passes /v1 and /auth to the API over
# HTTPS for the demo domain. Photos go to S3. Staging and production are the cell of decision D67,
# in the company's own accounts; nothing here carries over.
#
# State stays on the machine that applies it (git-ignored), as it holds the generated passwords.
# infra/scripts/demo.sh builds, deploys, pauses and resumes it; see infra/demo/README.md.

terraform {
  required_version = ">= 1.14"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.1"
    }
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = { Product = "thelamp", Environment = "demo", ManagedBy = "terraform" }
  }
}

variable "domain" {
  description = "Where the demo is served: the web portal, and the API under /v1 and /auth."
  type        = string
  default     = "app.thelamp.in"
}

variable "instance_type" {
  description = "A Free plan instance type; t4g.small has 2 GB, with 2 GB of swap beside it."
  type        = string
  default     = "t4g.small"
}

variable "demo_codes" {
  description = "Demo numbers and their fixed six-digit codes (DEMO_CODES): {\"+919800000001\" = \"482913\"}."
  type        = map(string)
  sensitive   = true
  default     = {}
}

data "aws_caller_identity" "current" {}

locals {
  name = "thelamp-demo"
  # Every process reads the same settings; secrets are generated below and never leave AWS and
  # this state.
  database = "thelamp"
  url      = "https://${var.domain}"
}

# The account's default network: one public subnet is all a single instance needs.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone"
    values = ["ap-south-1a"]
  }
}

data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# Only HTTPS, and HTTP for Let's Encrypt and redirects. No SSH: Session Manager reaches the box.
resource "aws_security_group" "demo" {
  name        = local.name
  description = "The demo: HTTP and HTTPS in, anything out"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description      = "HTTP, for certificates and redirects"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_s3_bucket" "media" {
  bucket        = "${local.name}-media-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The portal reads photos by presigned link, from its own origin.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_methods = ["GET", "PUT"]
    allowed_origins = [local.url]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_ecr_repository" "images" {
  for_each             = toset(["api", "postgres", "edge"])
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = aws_ecr_repository.images
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last three images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}

resource "random_password" "database" {
  for_each = toset(["postgres", "migrator", "cell_app", "directory_app"])
  length   = 32
  special  = false
}

resource "random_password" "otp_pepper" {
  length  = 48
  special = false
}

# The key that seals secrets kept in columns, such as TOTP seeds (decision D88).
resource "random_id" "column_key" {
  byte_length = 32
}

resource "tls_private_key" "jwt" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

locals {
  db = { for role, password in random_password.database : role => "postgres://${role}:${password.result}@postgres:5432/${local.database}" }
  settings = {
    NODE_ENV               = "production"
    CELL_PURPOSE           = "demo"
    PRODUCT_SLUG           = "thelamp"
    PRODUCT_NAME           = "The Lamp"
    HOST                   = "0.0.0.0"
    PORT                   = "3000"
    TRUST_PROXY            = "true"
    CELL_ID                = "demo"
    CELL_API_URL           = local.url
    CELL_REGION            = "ap-south-1"
    POSTGRES_PASSWORD      = random_password.database["postgres"].result
    DATABASE_BOOTSTRAP_URL = local.db["postgres"]
    BOOTSTRAP_CONFIRM_HOST = "postgres"
    DATABASE_MIGRATOR_URL  = local.db["migrator"]
    DATABASE_URL           = local.db["cell_app"]
    DIRECTORY_DATABASE_URL = local.db["directory_app"]
    REDIS_URL              = "redis://redis:6379"
    OBJECT_STORE           = "s3"
    S3_BUCKET              = aws_s3_bucket.media.bucket
    S3_REGION              = "ap-south-1"
    OTP_PROVIDER           = "none"
    DEMO_CODES             = jsonencode(var.demo_codes)
    PUSH_PROVIDER          = "expo"
    SMS_PROVIDER           = "console"
    EMAIL_PROVIDER         = "console"
    WHATSAPP_PROVIDER      = "console"
    PAYMENT_PROVIDER       = "console"
    OTP_PEPPER             = random_password.otp_pepper.result
    COLUMN_KEY             = random_id.column_key.b64_std
    JWT_SIGNING_KEY        = replace(tls_private_key.jwt.private_key_pem_pkcs8, "\n", "\\n")
  }
}

# The processes' settings, which demo.sh writes to the box at each deploy. A SecureString under
# the account's own SSM key: free, and readable only by the box and the account's admins.
resource "aws_ssm_parameter" "settings" {
  name  = "/${local.name}/env"
  type  = "SecureString"
  value = join("\n", [for key, value in local.settings : "${key}=${value}"])
}

resource "aws_iam_role" "demo" {
  name = local.name
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "managed" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ])
  role       = aws_iam_role.demo.name
  policy_arn = each.value
}

resource "aws_iam_role_policy" "demo" {
  name = "media-and-settings"
  role = aws_iam_role.demo.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:PutObjectTagging"]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation", "s3:CreateBucket"]
        Resource = aws_s3_bucket.media.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.settings.arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "demo" {
  name = local.name
  role = aws_iam_role.demo.name
}

resource "aws_instance" "demo" {
  ami                    = data.aws_ssm_parameter.ami.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.demo.id]
  iam_instance_profile   = aws_iam_instance_profile.demo.name

  root_block_device {
    volume_type = "gp3"
    volume_size = 30
    encrypted   = true
  }

  # Containers reach the instance's role through the metadata service, one hop further away.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  user_data = file("${path.module}/../../demo/user-data.sh")

  tags = { Name = local.name }

  lifecycle {
    # A newer Amazon Linux image doesn't replace a running demo.
    ignore_changes = [ami, user_data]
  }
}

# A fixed address, so the domain's record survives stopping and starting the instance.
resource "aws_eip" "demo" {
  instance = aws_instance.demo.id
  domain   = "vpc"
}

output "address" {
  description = "Point the domain's A record here."
  value       = aws_eip.demo.public_ip
}

output "domain" {
  value = var.domain
}

output "instance_id" {
  value = aws_instance.demo.id
}

output "registry" {
  value = split("/", aws_ecr_repository.images["api"].repository_url)[0]
}

output "settings_parameter" {
  value = aws_ssm_parameter.settings.name
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}
