#!/usr/bin/env bash
# Publishes a single-page app's build (spec 14.3): hashed assets cached for a year, index.html
# never, then a CloudFront invalidation. Needs WEB_BUCKET and WEB_DISTRIBUTION_ID, and a build in
# DIST: apps/web/dist by default, or apps/console/dist for the platform console (decision D88).
set -euo pipefail

: "${WEB_BUCKET:?}" "${WEB_DISTRIBUTION_ID:?}"
dist="${DIST:-apps/web/dist}"
aws s3 sync "$dist" "s3://$WEB_BUCKET" --delete --exclude index.html \
  --cache-control "public, max-age=31536000, immutable"
aws s3 cp "$dist/index.html" "s3://$WEB_BUCKET/index.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws cloudfront create-invalidation --distribution-id "$WEB_DISTRIBUTION_ID" --paths "/index.html" \
  --query Invalidation.Id --output text
