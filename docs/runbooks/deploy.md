# Deploy

How a cell is set up the first time, and how every change reaches it afterwards (spec 14.3, decision D67). Staging and production each live in their own AWS account, in `ap-south-1`, from `infra/environments/<environment>`.

## Routine deploys

Merging to `main` runs CI; when CI passes, the Deploy workflow rolls the commit out to staging, then to production after the production environment's reviewers approve. For each environment it:

1. builds the image for the commit, unless that environment's ECR already holds it;
2. registers new task definition revisions with the image (`infra/scripts/deploy-cell.sh`);
3. runs the migration task, and stops if it exits with anything but 0 ([failed migration](failed-migration.md));
4. moves the API, worker and scheduler onto the new revisions and waits until they are stable; the circuit breaker rolls a service back by itself if its new tasks keep failing;
5. watches the cell's alarms for 15 minutes, and fails if any fires ([rollback](rollback.md));
6. builds the web portal and publishes it to its bucket, then invalidates CloudFront; and the same for the platform console when the environment has a `console_domain` (decision D88).

To deploy by hand, run the Deploy workflow from GitHub's Actions tab with a commit, and choose staging or production.

Settings changed in Terraform reach the services at the next deploy: after `terraform apply`, run the Deploy workflow for the current commit.

## Setting up an environment

This needs the AWS accounts, opened as [AWS accounts](aws-accounts.md) sets out, a domain for the API, the web portal and media, an approved MSG91 account with DLT templates, and Amazon SES out of its sandbox. None of it is done until those exist.

### 1. Terraform state and the first apply

In the environment's account, create an S3 bucket for Terraform state (versioned, encrypted, private), then:

```bash
cd infra/environments/staging
cp backend.hcl.example backend.hcl            # name the state bucket
cp terraform.tfvars.example terraform.tfvars  # domains, alarm email, MSG91 template IDs
terraform init -backend-config=backend.hcl
```

Make the media signing key, which CloudFront checks signed URLs with: ECDSA P-256, as strong as the cell's other keys (decision D101). The public half goes in `terraform.tfvars` as `media_public_key_pem`; keep the private half for the secret below, and never commit it:

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out media-signing.pem
openssl ec -in media-signing.pem -pubout
```

With a Route 53 zone (`route53_zone_id`), one `terraform apply` does everything. Without one, apply the certificates first, add the `dns_records.validation` records the output lists at your DNS provider, wait for ACM to issue them, then apply everything and add the `dns_records.domains` records:

```bash
terraform apply -target=module.environment.aws_acm_certificate.api -target=module.environment.aws_acm_certificate.edge
terraform output dns_records
terraform apply
```

The services start with the image tag `bootstrap`, which doesn't exist yet, so they wait until the first deploy.

### 2. The cell's secret

Terraform creates the secret `thelamp-<environment>-cell1/app` (output `secret_arn`) but never its value. Set it once, as JSON, from a trusted machine. Database URLs use `sslmode=verify-full`, and passwords inside URLs are URL-encoded:

| Key | Value |
|---|---|
| `DATABASE_BOOTSTRAP_URL` | The RDS master user: `postgres://postgres:<password>@<database_address>:5432/<database_name>?sslmode=verify-full`, with both from `terraform output`. Its password is in the secret RDS keeps (output `database_master_secret_arn`). |
| `DATABASE_MIGRATOR_URL` | `postgres://migrator:<new password>@<database_address>:5432/<database_name>?sslmode=verify-full` |
| `DATABASE_URL` | `postgres://cell_app:<new password>@…` as above |
| `DIRECTORY_DATABASE_URL` | `postgres://directory_app:<new password>@…` as above |
| `OTP_PEPPER` | 48 random characters: `openssl rand -base64 36` |
| `COLUMN_KEY` | 32 random bytes in base64, which seal secrets kept in columns such as vendor staff's TOTP seeds: `openssl rand -base64 32` |
| `COLUMN_KEY_PREVIOUS` | Empty: it holds the old column key only while one is rotated ([secret rotation](secret-rotation.md)) |
| `ARCHIVE_SIGNING_KEY` | 32 random bytes in base64, the seed of the Ed25519 key tenant data exports are signed with (decision D95): `openssl rand -base64 32`. Publish the public key `ARCHIVE_SIGNING_KEY=… pnpm archive public-key` prints, so customers can check their archives; changing the seed changes it |
| `JWT_SIGNING_KEY` | A P-256 key, newlines written as `\n`: `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256` |
| `JWT_PUBLISHED_KEYS` | Empty: it holds the next or last signing key only while one is rotated ([secret rotation](secret-rotation.md)) |
| `CLOUDFRONT_PRIVATE_KEY` | `media-signing.pem`, newlines written as `\n` |
| `MSG91_AUTH_KEY` | From MSG91's dashboard |
| `SMTP_URL` | Amazon SES's SMTP credentials: `smtps://<user>:<password>@email-smtp.ap-south-1.amazonaws.com:465` |

Each process reads only the keys it uses (decision D101): the API all of them, the worker all but `OTP_PEPPER`, `JWT_SIGNING_KEY` and `JWT_PUBLISHED_KEYS`, and the scheduler the two database URLs alone. Every key must still be in the secret, empty where the table says so, or the tasks that read it won't start.

```bash
aws secretsmanager put-secret-value --secret-id <secret_arn> --secret-string file://cell-secret.json
shred -u cell-secret.json media-signing.pem
```

Two secrets need nothing from you (decision D101): Terraform makes Redis's AUTH token once and keeps it in `<cell>/redis` (the tasks read it as `REDIS_PASSWORD`), and keeps CloudFront's `X-Origin-Verify` value in `<cell>/origin` (the API reads it as `ORIGIN_SECRET`). A live cell refuses to start unless its database URLs use `sslmode=verify-full`, `REDIS_URL` is `rediss://` with that password, and `SMTP_URL` is `smtps://`.

The image pins Amazon's RDS certificate bundle by checksum. When Amazon publishes a new bundle the build fails: read what changed, then take the new checksum in `apps/api/Dockerfile`.

Settings that aren't secret, such as `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER`, `MSG91_SMS_TEMPLATES` and `MAIL_FROM`, go in `terraform.tfvars` under `environment`.

### 3. GitHub

In the repository's settings, create the GitHub environment (`staging` or `production`), and add as its variables the values of `terraform output github_variables`, plus `VITE_GOOGLE_MAPS_API_KEY`, the web's Maps key. `CONSOLE_BUCKET` and `CONSOLE_DISTRIBUTION_ID` are empty until `console_domain` is set in `terraform.tfvars`; the deploy publishes the console once they aren't. Invite the first platform admin with a one-off task of the image running `node dist/invite-staff.mjs --email … --name …`. Give `production` required reviewers. Then set the repository variable `DEPLOY_ENABLED` to `true`.

### 4. The first deploy, and the database's roles

Run the Deploy workflow for staging. Its migration fails the first time, because the database has no roles yet; that is expected. The image is now in ECR, so bootstrap the database once with the `bootstrap` task, which creates the three roles and the PostGIS, pg_trgm and pg_partman extensions. It refuses any host but the cell's own:

```bash
aws ecs run-task --cluster thelamp-staging-cell1 --launch-type FARGATE \
  --task-definition thelamp-staging-cell1-bootstrap \
  --network-configuration "awsvpcConfiguration={subnets=[<TASK_SUBNETS>],securityGroups=[<TASK_SECURITY_GROUP>]}"
```

Its logs are in `/thelamp-staging-cell1/bootstrap`. Then run the Deploy workflow again; it migrates and starts the services. `https://<api_domain>/ready` answers `ready` once the database, the directory and Redis are reachable.

### 5. The first tenant

Provisioning runs as a one-off API task with its command overridden, so it reaches the private database:

```bash
aws ecs run-task --cluster thelamp-staging-cell1 --launch-type FARGATE \
  --task-definition thelamp-staging-cell1-api \
  --network-configuration "awsvpcConfiguration={subnets=[<TASK_SUBNETS>],securityGroups=[<TASK_SECURITY_GROUP>]}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/provision.mjs","--name","<name>","--slug","<slug>","--template","agri","--admin-name","<name>","--admin-phone","<number>"]}]}'
```

A tenant prepared elsewhere starts from its exported configuration instead (decision D66): copy the file into the task, or provision from the template and import the file in Settings › Export and import.
