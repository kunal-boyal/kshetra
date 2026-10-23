# Services

This file lists every service The Lamp uses: where it runs, why, and when it arrives. It draws on spec sections 9.2 (stack), 14.1 (environments) and 14.2 (AWS topology), and on Appendix F (settings). Update it whenever a service is added, replaced or moves to another phase.

## Local development (Docker Compose)

`docker-compose.yml` runs these four on the developer's machine. Each stands in for a production AWS service, so the code runs offline without an AWS account. Every port binds to 127.0.0.1, so only that machine can reach them.

| Service | Port | What it does for The Lamp | Production twin |
|---|---|---|---|
| PostgreSQL 18, with PostGIS, pg_partman and pg_trgm | 5433 (`POSTGRES_PORT`) | The database. It holds every tenant's data and keeps tenants apart with row-level security. PostGIS stores GPS points and works out geofences and distances. pg_partman splits the high-volume location table into partitions. pg_trgm powers fuzzy name matching and search. | Amazon RDS for PostgreSQL |
| Redis 8.10 | 6380 (`REDIS_PORT`) | Sign-in rate limits and tenant-choice tickets today (step 4). From phase 1 it also holds the background job queues (SMS, push, photo processing, exports, webhooks), so requests never wait on slow work, and caches. | Amazon ElastiCache |
| MinIO, Chainguard's image (decision D21) | 9000 for the S3 API, 9001 for its console | File storage (bucket `kshetra-local`, which the API creates on start): import files from phase 1 step 4, and photos from step 6, which phones upload straight to it through short-lived signed links. Exports will wait there for download. | Amazon S3 |
| Mailpit | 1025 for SMTP, 8025 for the inbox page | Catches every email the app sends, such as finished imports (decision D58), so none reach real inboxes. Read them at http://localhost:8025. | Amazon SES, through `EMAIL_PROVIDER=smtp` and `SMTP_URL` |

- **Starting and stopping:** `docker compose up -d` starts them, and `docker compose stop` stops them. PostgreSQL and MinIO keep their data in Docker volumes.
- **Credentials:** `kshetra` / `kshetra-local` work only for these local containers.
- **Ports:** 5433 and 6380 leave 5432 and 6379 free for a PostgreSQL or Redis already installed on the machine.

## Production on AWS (from phase 1)

The region is ap-south-1 (Mumbai), with disaster recovery in ap-south-2 (Hyderabad). Everything is built by Terraform from `infra/` (decision D67), never by hand; staging and production each have their own account. Setting one up: `docs/runbooks/deploy.md`. The pilot starts on the lean cell: a single-zone database, one Valkey node, one API task and one worker.

| Service | What it does |
|---|---|
| RDS for PostgreSQL | The database, with 14 days of point-in-time recovery. Multi-AZ, a read replica and snapshots copied to Hyderabad come with the production cell's sizes. |
| ElastiCache for Valkey (Redis-compatible) | Queues, rate limits and live positions; replication and failover with two or more nodes |
| S3 | Stores media and exports. Versioning and lifecycle rules delete files by retention class. Also hosts the web apps. |
| CloudFront | Serves media through short-lived signed URLs, and serves the web apps |
| SES | Sends email (directory plane) |
| ECS on Fargate | Runs the `api`, `worker`, `scheduler` and one-off `migrate` and `bootstrap` tasks, all from one image (`apps/api/Dockerfile`) |
| ECR | Stores the container images, one per commit |
| Application Load Balancer, ACM, WAF | HTTPS entry point, certificates and web firewall |
| Secrets Manager, KMS | Holds secrets, one JSON secret per cell, and the keys for encrypted columns, outside the code |
| IAM with GitHub's OIDC | The deploy role GitHub Actions takes, so no AWS keys are stored in GitHub |
| CloudWatch, OpenTelemetry collector | Logs, alarms and traces |
| VPC, NAT gateway, VPC endpoints | The private network the services run in |

**Cost:** check in the AWS Pricing Calculator before committing (spec 14.2).
- A lean pilot cell costs a few hundred US dollars a month.
- A production cell with Multi-AZ, a replica and autoscaling costs in the low thousands a month, before media storage.

## The demo (decision D70)

The whole product on one EC2 instance in Kunal's personal AWS sandbox, on the Free plan's credit, for showing to prospects; see [infra/demo/README.md](../infra/demo/README.md). It isn't staging, and nothing in it carries over.

| Service | What it does |
|---|---|
| EC2 `t4g.small` with an Elastic IP | Runs PostgreSQL, Redis, the API, worker, scheduler and Caddy in Docker Compose, at `app.thelamp.in` |
| S3 | Photos and exports, through presigned links |
| ECR | The demo's images, built on the Mac for ARM |
| Systems Manager | Session Manager and Run Command reach the instance with no SSH; Parameter Store holds its settings |
| Let's Encrypt, through Caddy | The domain's certificate |

## Outside providers

| Provider | What for | Needed from | Settings (Appendix F) |
|---|---|---|---|
| MSG91, with DLT registration (decision D67) | OTP sign-in codes and SMS notifications, each through a DLT-approved template | Before the pilot: DLT registration needs the legal entity (D1). Locally, codes and SMS notifications print to the console (decision D58). | `OTP_PROVIDER=msg91`, `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_OTP_VARIABLE`, `MSG91_SENDER`, `MSG91_SMS_TEMPLATES` |
| Expo push, with Firebase Cloud Messaging (Android) and Apple Push (iPhones) behind it (decision D58) | Push notifications | Before the pilot: a Firebase project for Android; APNs with the Apple account. Locally, push prints to the console. | `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN`; the Firebase key is uploaded to Expo with `eas credentials` |
| Google Maps Platform (decisions D13, D60) | Maps, routes, the live map, day replay and visit density | In use since 2026-10-21, in Google Cloud project `kshetra-e3874` with billing: a web key limited to the Maps JavaScript API and the portal's origins, and an Android key limited to the Maps SDK and both apps' certificates. Add the production origin to the web key, and a budget alert, before the pilot. | `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`, `GOOGLE_MAPS_ANDROID_KEY` |
| Sentry | Errors and crashes from every app | Once the apps run outside a laptop | `SENTRY_DSN`, `VITE_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN` |
| WhatsApp Business Platform, through a provider (decision D12) | Plan reminders and approval messages | Phase 2 | `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, `WHATSAPP_SENDER_ID` |
| Razorpay Subscriptions | Subscription billing, UPI and card mandates, GST invoices | Phase 3 | `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| SSO, through customers' OIDC and SAML identity providers | Enterprise sign-in | Phase 3 | Per tenant |
| OCR provider, available in-region (optional) | Reading receipts and odometers | When a tenant switches it on | `OCR_PROVIDER` |

## Building and shipping

| Service | What for | Status |
|---|---|---|
| GitHub | The private repository; GitHub Actions runs CI on every pull request (`.github/workflows/ci.yml`), and deploys `main` once AWS is connected (`deploy.yml`, decision D67) | In use; deploys off until `DEPLOY_ENABLED` |
| npm registry | JavaScript packages | In use |
| Docker Hub | The PostgreSQL, Redis and Mailpit images (Mailpit also takes local sign-in codes for Maestro, decision D68), the API image's `node:24-bookworm-slim` base, and `hashicorp/terraform` for checking Terraform locally | In use |
| Chainguard registry | The MinIO image (decision D21) | In use |
| claude.ai | The design-system artifact, kept in step with `packages/design-tokens` | In use |
| Expo EAS (Build and Update) | Builds the mobile app and ships JavaScript updates | Build in use on Kunal's account; Update needs `expo-updates` in a new build (step 17c) |
| Google Play Console | Closed testing in phase 1, public release in phase 3 | Phase 1 |
| Apple App Store Connect | TestFlight and release | Phase 3, or earlier for iPhone testing |

## Accounts to open early

Some sign-ups take weeks:
- **DLT registration for SMS** needs the legal entity first (decision D1).
- **Google Play and Apple organisation accounts** both need a D-U-N-S number.
- **AWS** is needed for phase 1's development cell.
