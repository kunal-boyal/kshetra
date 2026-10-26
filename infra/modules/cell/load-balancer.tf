# The cell's front door (spec 14.2): HTTPS on the load balancer, behind AWS's managed WAF rules.

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  idle_timeout               = 60
  tags                       = var.tags
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.name}-api"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = var.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  # TLS 1.3, and TLS 1.2 with forward-secret AEAD suites only (decision D101).
  ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-Res-2021-06"
  certificate_arn = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# No plain HTTP listener: apps and API clients call HTTPS only, and a mistyped client can't even
# connect, so it never sends its token in clear first (decision D101).

# The WAF review (decision D98): AWS's common, known-bad-input and IP-reputation rules block; the
# SQL injection rules count until the pilot's sampled requests show free-text notes don't trip
# them; and sign-in is throttled per address. Requests CloudFront passes on carry its secret
# header and are throttled by CloudFront's own WAF, which sees the viewer.
locals {
  managed_rules = {
    AWSManagedRulesCommonRuleSet          = { priority = 1, count = false }
    AWSManagedRulesKnownBadInputsRuleSet  = { priority = 2, count = false }
    AWSManagedRulesAmazonIpReputationList = { priority = 3, count = false }
    AWSManagedRulesSQLiRuleSet            = { priority = 4, count = true }
  }
  sign_in_pattern = "^/(auth/v1/(otp|totp|oauth|sso|support)/|platform/v1/(session|setup)(/confirm)?$)"
}

resource "aws_wafv2_regex_pattern_set" "sign_in" {
  name  = "${var.name}-sign-in"
  scope = "REGIONAL"
  regular_expression {
    regex_string = local.sign_in_pattern
  }
  tags = var.tags
}

resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }

  rule {
    name     = "SignInPerAddress"
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
          and_statement {
            statement {
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
            statement {
              not_statement {
                statement {
                  byte_match_statement {
                    # Without CloudFront in front, no request carries the header.
                    search_string         = coalesce(var.origin_secret, "none")
                    positional_constraint = "EXACTLY"
                    field_to_match {
                      single_header {
                        name = "x-origin-verify"
                      }
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SignInPerAddress"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.managed_rules
    content {
      name     = rule.key
      priority = rule.value.priority
      override_action {
        dynamic "none" {
          for_each = rule.value.count ? [] : [1]
          content {}
        }
        dynamic "count" {
          for_each = rule.value.count ? [1] : []
          content {}
        }
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
          # Import files and logos arrive as the request body (up to 20 MB), which the common
          # set's body-size rule would block; the API checks sizes itself.
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
  tags = var.tags
}

# What the WAF saw, for its review; never the tokens, cookies or CloudFront's secret.
resource "aws_cloudwatch_log_group" "waf" {
  # WAF writes only to log groups whose names start so.
  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
  tags              = var.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  dynamic "redacted_fields" {
    for_each = ["authorization", "cookie", "x-origin-verify"]
    content {
      single_header {
        name = redacted_fields.value
      }
    }
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
