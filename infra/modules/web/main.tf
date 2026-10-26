# A single-page app (spec 14.2): the web portal, or the platform console (decision D88). Its build
# sits in a private bucket behind CloudFront, which also passes the app's API paths to the cell,
# so the app and the API share one origin, as they do locally: the refresh token's cookie stays
# first-party and no CORS is needed (decision D35).
# CloudFront's certificate and WAF live in us-east-1, so this module takes a provider for it there.

variable "name" {
  type = string
}

variable "domain" {
  description = "The portal's domain, such as app.example.com."
  type        = string
}

variable "certificate_arn" {
  description = "An ACM certificate for domain, in us-east-1."
  type        = string
}

variable "api_domain" {
  description = "The cell's domain, which api_paths go to."
  type        = string
}

variable "api_paths" {
  description = "The paths CloudFront passes to the cell: the portal's /v1 and /auth, or the console's /platform."
  type        = list(string)
  default     = ["/v1/*", "/auth/*"]
}

variable "origin_secret" {
  description = "Sent to the cell as X-Origin-Verify with every request passed on, so the cell's WAF leaves throttling those to this one (decision D98)."
  type        = string
  sensitive   = true
}

variable "sign_in_pattern" {
  description = "The paths of sign-in attempts, which the WAF throttles per viewer."
  type        = string
  default     = "^/(auth/v1/(otp|totp|oauth|sso|support)/|platform/v1/(session|setup)(/confirm)?$)"
}

variable "sign_in_per_5_minutes" {
  description = "Sign-in attempts one viewer may make in 5 minutes before the WAF blocks it (spec 13)."
  type        = number
  default     = 300
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_s3_bucket" "web" {
  bucket = "${var.name}-web"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Paths without a file extension are the app's routes, served by index.html.
resource "aws_cloudfront_function" "spa" {
  name    = "${var.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (!request.uri.split('/').pop().includes('.')) request.uri = '/index.html';
      return request;
    }
  JS
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_but_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${var.name} web portal"
  aliases             = [var.domain]
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  is_ipv6_enabled     = true

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.api_domain
    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_secret
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.api_paths
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "api"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_but_host.id
      compress                 = true
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  web_acl_id = aws_wafv2_web_acl.edge.arn

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.web]
}

output "bucket" {
  value = aws_s3_bucket.web.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.web.arn
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.web.arn
}

output "distribution_domain" {
  description = "Point domain here."
  value       = aws_cloudfront_distribution.web.domain_name
}

# The viewer's side of the WAF review (decision D98): sign-in throttled per viewer, which the
# cell's WAF can't see behind CloudFront, and AWS's IP-reputation list.
resource "aws_wafv2_regex_pattern_set" "sign_in" {
  provider = aws.us_east_1
  name     = "${var.name}-sign-in"
  scope    = "CLOUDFRONT"
  regular_expression {
    regex_string = var.sign_in_pattern
  }
  tags = var.tags
}

resource "aws_wafv2_web_acl" "edge" {
  provider = aws.us_east_1
  name     = "${var.name}-edge"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }

  rule {
    name     = "SignInPerViewer"
    priority = 0
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.sign_in_per_5_minutes
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        scope_down_statement {
          regex_pattern_set_reference_statement {
            arn = aws_wafv2_regex_pattern_set.sign_in.arn
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SignInPerViewer"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesAmazonIpReputationList"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-edge"
    sampled_requests_enabled   = true
  }
  tags = var.tags
}
