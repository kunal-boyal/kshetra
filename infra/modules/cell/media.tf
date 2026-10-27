# Photos, imports, exports, logos and location archives (spec 12.2): a private, versioned bucket.
# Phones upload by presigned URL straight to S3; reads go through CloudFront with signed URLs.
# Retention is the app's (decision D69): nightly jobs remove evidence photos with their stamped
# copies, location archives and exports once each tenant's keeping time is over, and mark their
# rows deleted. These rules only tidy what is left behind.

resource "aws_s3_bucket" "media" {
  bucket = "${var.name}-media"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Files are encrypted under a key of the cell's own (spec 13.1, ASVS V14.2.4, decision D101): the
# tasks and CloudFront's reads of this distribution may use it, nothing else. Files stored before
# keep S3's own encryption until they are rewritten or expire.
resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.media.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_kms_key" "media" {
  description             = "${var.name} media"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.media_key.json
  tags                    = var.tags
}

resource "aws_kms_alias" "media" {
  name          = "alias/${var.name}-media"
  target_key_id = aws_kms_key.media.key_id
}

data "aws_iam_policy_document" "media_key" {
  # The account administers the key, and IAM policies, such as the tasks', grant its use.
  statement {
    sid       = "Account"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudFrontReads"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "tidy"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
    # A removed file can be restored for 30 days, then it is gone.
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.name}-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "media" {
  name        = "${var.name}-media"
  encoded_key = var.media_public_key_pem
}

resource "aws_cloudfront_key_group" "media" {
  name  = "${var.name}-media"
  items = [aws_cloudfront_public_key.media.id]
}

# Edges keep a file no longer than a read link lasts (READ_LINK_SECONDS, five minutes), so a
# file removed by retention or an erasure stops being served within minutes (ASVS V14.2.2,
# decision D101). The signature's query string stays out of the key, as before.
resource "aws_cloudfront_cache_policy" "media" {
  name        = "${var.name}-media"
  comment     = "${var.name} media: kept five minutes at most"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 300
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Files are what they say they are, never framed, and never tell where they were opened from
# (decision D101).
resource "aws_cloudfront_response_headers_policy" "media" {
  name    = "${var.name}-media"
  comment = "${var.name} media: nosniff, HSTS, no framing"
  security_headers_config {
    content_type_options {
      override = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      override                   = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
  }
}

# With its own domain, media is served with TLS 1.2 or later; production must have one (decision
# D100). Without one, as staging may be, CloudFront's default certificate can't be held to that.
# nosemgrep: terraform.aws.security.aws-cloudfront-insecure-tls.aws-insecure-cloudfront-distribution-tls-version
resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  comment         = "${var.name} media"
  aliases         = var.media_domain == null ? [] : [var.media_domain]
  price_class     = "PriceClass_200"
  is_ipv6_enabled = true

  origin {
    origin_id                = "media"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id           = "media"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.media.id
    trusted_key_groups         = [aws_cloudfront_key_group.media.id]
    response_headers_policy_id = aws_cloudfront_response_headers_policy.media.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.media_domain == null
    acm_certificate_arn            = var.media_domain_certificate_arn
    ssl_support_method             = var.media_domain == null ? null : "sni-only"
    minimum_protocol_version       = var.media_domain == null ? null : "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontReads"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.media.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media.arn } }
      },
      {
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.media]
}
