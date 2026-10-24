# Secret rotation

Every secret lives in the cell's Secrets Manager secret, `thelamp-<environment>-cell1/app`, one key per setting (decision D67). Rotate on a schedule, when someone with access leaves, and at once on any suspicion of a leak.

| Key | How | Effect on people |
|---|---|---|
| Database passwords (`DATABASE_URL`, `DIRECTORY_DATABASE_URL`, `DATABASE_MIGRATOR_URL`) | `alter role <role> password '<new>'` as the master user (a one-off bootstrap task with the new URLs does this), then update the secret, then deploy | None |
| RDS master password | RDS rotates it in its own secret; update `DATABASE_BOOTSTRAP_URL` after | None |
| `JWT_SIGNING_KEY` | Make a new P-256 key, update the secret, deploy | Access tokens last 15 minutes; apps refresh with their refresh token and carry on |
| `OTP_PEPPER` | New random value, update the secret, deploy | Codes sent in the last 5 minutes stop working; people ask for a new one |
| `COLUMN_KEY` | Not rotated in place yet: sealed values carry a version (`v1`), and a second key version arrives with the next sealed secret (decision D88). Until then, a new key means every vendor staff member is invited again to set up a new authenticator | Staff can't sign in to the console until they set up again |
| `CLOUDFRONT_PRIVATE_KEY` | A new key pair: add its public half in Terraform as a second key in the key group, apply, update the secret, deploy, then remove the old public key | Photo links last minutes; open screens fetch new ones |
| `MSG91_AUTH_KEY` | A new key in MSG91's dashboard, update the secret, deploy, then revoke the old key | None |
| `SMTP_URL` | New SES SMTP credentials, update the secret, deploy, then delete the old IAM user's keys | None |

After updating the secret, run the Deploy workflow for the current commit: running tasks read the secret only when they start. Never paste a secret's value into an issue, a chat or a log.
