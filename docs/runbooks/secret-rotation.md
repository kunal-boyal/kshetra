# Secret rotation

Every secret lives in the cell's Secrets Manager secret, `thelamp-<environment>-cell1/app`, one key per setting (decision D67). Rotate on a schedule, when someone with access leaves, and at once on any suspicion of a leak.

| Key | How | Effect on people |
|---|---|---|
| Database passwords (`DATABASE_URL`, `DIRECTORY_DATABASE_URL`, `DATABASE_MIGRATOR_URL`) | `alter role <role> password '<new>'` as the master user (a one-off bootstrap task with the new URLs does this), then update the secret, then deploy | None |
| RDS master password | RDS rotates it in its own secret; update `DATABASE_BOOTSTRAP_URL` after | None |
| `JWT_SIGNING_KEY` | In three deploys, so no task ever meets a token signed by a key it doesn't know (decision D101). 1: make a new P-256 key and put it in `JWT_PUBLISHED_KEYS`, deploy; every task now trusts it. 2: make it `JWT_SIGNING_KEY` and move the old one to `JWT_PUBLISHED_KEYS`, deploy. 3: after 15 minutes, empty `JWT_PUBLISHED_KEYS`, deploy | None: tokens signed by either key keep working until they run out |
| `OTP_PEPPER` | New random value, update the secret, deploy | Codes sent in the last 5 minutes stop working; people ask for a new one |
| `COLUMN_KEY` | 1: move the current key to `COLUMN_KEY_PREVIOUS`, put a new one (`openssl rand -base64 32`) in `COLUMN_KEY`, deploy; new values are sealed under it and old ones still open. 2: run `pnpm reseal` once as a one-off task (`node dist/reseal.mjs`, with the API's settings), which seals every authenticator, SSO connection and webhook secret again under the new key and says how many; running it again finds none. 3: empty `COLUMN_KEY_PREVIOUS`, deploy (decision D101) | None |
| `CLOUDFRONT_PRIVATE_KEY` | A new ECDSA P-256 key pair ([deploy](deploy.md)): add its public half in Terraform as a second key in the key group, apply, update the secret and `CLOUDFRONT_KEY_ID`, deploy, then remove the old public key | Photo links last minutes; open screens fetch new ones |
| `MSG91_AUTH_KEY` | A new key in MSG91's dashboard, update the secret, deploy, then revoke the old key | None |
| `SMTP_URL` | New SES SMTP credentials, update the secret, deploy, then delete the old IAM user's keys | None |

After updating the secret, run the Deploy workflow for the current commit: running tasks read the secret only when they start. Never paste a secret's value into an issue, a chat or a log.
