# Services

This file lists every service Kshetra uses: where it runs, why, and when it arrives. It draws on spec sections 9.2 (stack), 14.1 (environments) and 14.2 (AWS topology), and on Appendix F (settings). Update it whenever a service is added, replaced or moves to another phase.

## Local development (Docker Compose)

`docker-compose.yml` runs these four on the developer's machine. Each stands in for a production AWS service, so the code runs offline without an AWS account. Every port binds to 127.0.0.1, so only that machine can reach them.

| Service | Port | What it does for Kshetra | Production twin |
|---|---|---|---|
| PostgreSQL 18, with PostGIS, pg_partman and pg_trgm | 5433 (`POSTGRES_PORT`) | The database. It holds every tenant's data and keeps tenants apart with row-level security. PostGIS stores GPS points and works out geofences and distances. pg_partman splits the high-volume location table into partitions. pg_trgm powers fuzzy name matching and search. | Amazon RDS for PostgreSQL |
| Redis 8.10 | 6380 (`REDIS_PORT`) | Sign-in rate limits and tenant-choice tickets today (step 4). From phase 1 it also holds the background job queues (SMS, push, photo processing, exports, webhooks), so requests never wait on slow work, and caches. | Amazon ElastiCache |
| MinIO, Chainguard's image (decision D21) | 9000 for the S3 API, 9001 for its console | File storage (bucket `kshetra-local`, which the API creates on start): import files from phase 1 step 4, and photos from step 6, which phones upload straight to it through short-lived signed links. Exports will wait there for download. | Amazon S3 |
| Mailpit | 1025 for SMTP, 8025 for the inbox page | Catches every email the app sends, so none reach real inboxes. Read them at http://localhost:8025. | Amazon SES |

- **Starting and stopping:** `docker compose up -d` starts them, and `docker compose stop` stops them. PostgreSQL and MinIO keep their data in Docker volumes.
- **Credentials:** `kshetra` / `kshetra-local` work only for these local containers.
- **Ports:** 5433 and 6380 leave 5432 and 6379 free for a PostgreSQL or Redis already installed on the machine.

## Production on AWS (from phase 1)

The region is ap-south-1 (Mumbai), with disaster recovery in ap-south-2 (Hyderabad). Everything is built by Terraform from `infra/terraform`, never by hand. It's needed from phase 1, when the development cell is built.

| Service | What it does |
|---|---|
| RDS for PostgreSQL | The database: Multi-AZ, a read replica, 14 days of point-in-time recovery, and daily snapshots copied to Hyderabad |
| ElastiCache (Redis-compatible) | Queues and cache, with replication and failover |
| S3 | Stores media and exports. Versioning and lifecycle rules delete files by retention class. Also hosts the web apps. |
| CloudFront | Serves media through short-lived signed URLs, and serves the web apps |
| SES | Sends email (directory plane) |
| ECS on Fargate | Runs the `api`, `worker`, `scheduler` and one-off `migrate` containers |
| ECR | Stores the container images, one per commit |
| Application Load Balancer, ACM, WAF | HTTPS entry point, certificates and web firewall |
| Secrets Manager, KMS | Holds secrets and the keys for encrypted columns, outside the code |
| CloudWatch, OpenTelemetry collector | Logs, alarms and traces |
| VPC, NAT gateway, VPC endpoints | The private network the services run in |

**Cost:** check in the AWS Pricing Calculator before committing (spec 14.2).
- A lean pilot cell costs a few hundred US dollars a month.
- A production cell with Multi-AZ, a replica and autoscaling costs in the low thousands a month, before media storage.

## Outside providers

| Provider | What for | Needed from | Settings (Appendix F) |
|---|---|---|---|
| SMS provider (MSG91 or equivalent), with DLT registration | OTP sign-in codes and SMS notifications | Phase 1. Locally, OTP codes print to the console. | `OTP_PROVIDER`, `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_TEMPLATE_IDS` |
| Firebase Cloud Messaging and Apple Push, directly or through Expo push | Push notifications | Phase 1 | `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, or `EXPO_ACCESS_TOKEN` |
| Google Maps Platform (decision D13) | Maps, routes, the live map and day replay | Phase 1 | `VITE_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_ANDROID_KEY` |
| Sentry | Errors and crashes from every app | Once the apps run outside a laptop | `SENTRY_DSN`, `VITE_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN` |
| WhatsApp Business Platform, through a provider (decision D12) | Plan reminders and approval messages | Phase 2 | `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, `WHATSAPP_SENDER_ID` |
| Razorpay Subscriptions | Subscription billing, UPI and card mandates, GST invoices | Phase 3 | `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| SSO, through customers' OIDC and SAML identity providers | Enterprise sign-in | Phase 3 | Per tenant |
| OCR provider, available in-region (optional) | Reading receipts and odometers | When a tenant switches it on | `OCR_PROVIDER` |

## Building and shipping

| Service | What for | Status |
|---|---|---|
| GitHub | The private repository; GitHub Actions runs CI on every pull request (`.github/workflows/ci.yml`) | In use |
| npm registry | JavaScript packages | In use |
| Docker Hub | The PostgreSQL, Redis and Mailpit images | In use |
| Chainguard registry | The MinIO image (decision D21) | In use |
| claude.ai | The design-system artifact, kept in step with `packages/design-tokens` | In use |
| Expo EAS (Build and Update) | Builds the mobile app and ships JavaScript updates | Later in phase 0 |
| Google Play Console | Closed testing in phase 1, public release in phase 3 | Phase 1 |
| Apple App Store Connect | TestFlight and release | Phase 3, or earlier for iPhone testing |

## Accounts to open early

Some sign-ups take weeks:
- **DLT registration for SMS** needs the legal entity first (decision D1).
- **Google Play and Apple organisation accounts** both need a D-U-N-S number.
- **AWS** is needed for phase 1's development cell.
