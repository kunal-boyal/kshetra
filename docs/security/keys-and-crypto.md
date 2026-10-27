# Keys and cryptography

How the product's keys are made, kept, used, rotated and destroyed, and every cryptographic primitive it relies on (ASVS 5.0 V11.1.1, V11.1.2, V11.2.2; decision D101). The steps for each rotation are in [secret-rotation.md](../runbooks/secret-rotation.md); how each key is first made is in [deploy.md](../runbooks/deploy.md).

## The policy

- **Generation.** Keys come from a cryptographic source only: `openssl` (`rand`, `genpkey`, `ecparam`), Node's `crypto` (`randomBytes`, `randomInt`, `generateKeyPair`), Terraform's `aws_secretsmanager_random_password` or AWS KMS. Never a password, a word or a value typed by hand.
- **Storage.** Every key a cell uses is a key of its Secrets Manager secret (`thelamp-<environment>-cell1/app`), or a secret of its own for the Redis token (`<cell>/redis`) and the origin secret, or lives inside KMS and never leaves it. Nothing is committed: `.env.example` holds placeholders, local `.env` files are git-ignored, and Semgrep and the review of every pull request look for secrets. The licence signing key never enters the repository or AWS; it stays on a vendor laptop (docs/runbooks/licences.md).
- **Access.** Only the cell's ECS execution role reads the secret, and each process gets only the keys it uses (`ROLE_SECRETS` in `apps/api/src/config.ts`, mirrored in `infra/modules/cell/services.tf`): the API all of them, the worker what its jobs use, the scheduler the database URLs alone. Nobody reads a secret's value in the console except to rotate it, and a value is never pasted into an issue, a chat or a log.
- **Custodian.** Kunal, as owner, until the company's AWS Organization exists and names a security owner; then that person, with a second person able to rotate in their absence.
- **Rotation.** Each key below has a cryptoperiod. Rotate at its end, when anyone who could read it leaves, and at once on any suspicion of a leak. Every rotation is a deploy, so it is recorded in the deploy history, and an entry in the table at the end of this page.
- **Destruction.** A key leaves service by being removed from the secret and the deploy that follows; Secrets Manager keeps earlier versions only until the next rotation. KMS keys are never deleted while data they encrypted is kept; when a cell is retired, they are scheduled for deletion with the 30-day window Terraform sets, after its backups have expired.
- **Agility.** Every stored ciphertext or hash names its scheme, so a key or algorithm can change without a flag day: sealed columns carry `v2:<key id>:`, password and recovery-code hashes carry their scrypt parameters, archive manifests their key ID, JWTs their `kid`, and the JWKS can publish two keys at once.

## Keys

| Key | Algorithm and strength | Protects | Held by | Cryptoperiod | Rotation |
|---|---|---|---|---|---|
| `JWT_SIGNING_KEY`, `JWT_PUBLISHED_KEYS` | ECDSA P-256 (ES256), 128-bit | Access tokens for tenant users, API clients and vendor staff | API | 1 year | Three deploys through `JWT_PUBLISHED_KEYS`, no token refused |
| `COLUMN_KEY`, `COLUMN_KEY_PREVIOUS` | AES-256-GCM, 96-bit random nonce, the column and row as associated data | TOTP seeds (tenant and staff), SSO client secrets and private keys, webhook signing secrets | API, worker | 1 year | `COLUMN_KEY_PREVIOUS`, then `pnpm reseal`, then empty it |
| `OTP_PEPPER` | HMAC-SHA-256 key, 288 bits | Stored SMS codes (each an HMAC of its challenge and code) | API | 1 year | Replace; codes of the last five minutes stop working |
| `ARCHIVE_SIGNING_KEY` | Ed25519 seed, 128-bit | Tenant data exports and personal-data archives, which customers verify | API, worker | 3 years, or on compromise | Replace; publish the new public key with its start date beside the old one, which still verifies older archives |
| `CLOUDFRONT_PRIVATE_KEY` | ECDSA P-256 with SHA-256 | Signed media links, five minutes each | API, worker | 1 year | Second public key in the key group, then swap |
| Licence key (vendor laptop) | Ed25519, 128-bit | Licence files of dedicated installs | Vendor only | 3 years, or on compromise | New pair; every install gets the new public key with its next licence |
| Database passwords (`DATABASE_URL`, `DIRECTORY_DATABASE_URL`, `DATABASE_MIGRATOR_URL`) | Random, 32 characters or more | The `cell_app`, `directory_app` and `migrator` roles | API, worker, scheduler; migrate | 1 year | `alter role … password`, update the secret, deploy |
| RDS master password | Managed by RDS in its own secret | The `postgres` role, used only by `bootstrap` | RDS | RDS's own rotation | RDS |
| Redis AUTH token (`REDIS_PASSWORD`) | Random, from Secrets Manager | Valkey | API, worker, scheduler | 1 year | Terraform's `ROTATE` strategy: new token, both accepted, then the old one dropped |
| `ORIGIN_SECRET` | Random, from Secrets Manager | The `X-Origin-Verify` header CloudFront adds, which lets the API believe the viewer's address | CloudFront, API | 1 year | Replace in Terraform and apply; both edges take the new value together |
| `MSG91_AUTH_KEY` | Provider API key | Sending SMS | API, worker | 1 year | New key in MSG91, deploy, revoke the old |
| `SMTP_URL` | SES SMTP credentials | Sending email | API, worker | 1 year | New IAM credentials, deploy, delete the old |
| KMS keys: media, logs | AES-256 in KMS, rotated by AWS | Media objects; the cell's log groups | KMS | Yearly, automatic (`enable_key_rotation`) | AWS |
| AWS-managed KMS keys | AES-256 in KMS | RDS storage and snapshots, ElastiCache at rest, Secrets Manager | KMS | AWS's schedule | AWS |
| TLS certificates | ACM (RSA-2048 or P-256), TLS 1.3 or 1.2 with forward-secret AEAD suites | Every public endpoint | ACM | 13 months, renewed by ACM | Automatic |

Locally and in tests, without `COLUMN_KEY` or `ARCHIVE_SIGNING_KEY`, a key is derived from `OTP_PEPPER` with HKDF-SHA-256 under its own label; production refuses to start without the real keys.

## Secrets the product makes

| Secret | Made from | Kept as |
|---|---|---|
| Refresh tokens, tenant tickets, second-factor tickets | 32 random bytes | SHA-256 digest |
| SMS sign-in codes | `randomInt`, six digits | HMAC-SHA-256 under `OTP_PEPPER`, bound to the challenge |
| API client secrets | Random bytes, base64url | SHA-256 digest, compared in constant time; shown once |
| Webhook signing secrets | 24 random bytes (`whsec_`) | Sealed under `COLUMN_KEY`; shown once |
| TOTP seeds | 20 random bytes (160 bits) | Sealed under `COLUMN_KEY` |
| Recovery codes | 50 random bits each | scrypt N = 2^14, r = 8, p = 1, salted |
| Staff passwords | Chosen by staff, 12 to 200 characters, checked against context words and breaches | scrypt N = 2^15, r = 8, p = 3, 16-byte salt, parameters stored |
| SSO state, nonce and PKCE verifier | 16 or more random bytes | In Redis until used; the browser binder cookie as a digest |
| Staff setup and support entry links | 32 random bytes | SHA-256 digest, single use |

## Primitives

| Primitive | Where | Notes |
|---|---|---|
| AES-256-GCM | Column cipher (`src/platform/column-cipher.ts`) | Fresh 96-bit nonce per seal; associated data names the column and row |
| ECDSA P-256 with SHA-256 | Access tokens (`jose`, pinned to ES256), CloudFront signed links | |
| Ed25519 | Data export and licence signatures | |
| HMAC-SHA-256 | SMS codes; webhook signatures (Standard Webhooks) | |
| HMAC-SHA-1 | TOTP (RFC 6238, 30-second steps, six digits) | As the standard and every authenticator app require; HMAC-SHA-1 keeps its strength as a MAC |
| SHA-256 | Digests of bearer secrets, rate-limit keys, idempotency bodies, photo, import and archive checksums, canonical JSON | |
| SHA-1 | Have I Been Pwned's range query only | Not a security use: the first five hex digits of a password's SHA-1 are what the service indexes |
| scrypt | Staff passwords, recovery codes | |
| HKDF-SHA-256 | Local key derivation only | |
| Difference hash (dHash) | Duplicate photos (BR-40) | Not cryptographic; a similarity signal |
| TLS | All transport | Database `sslmode=verify-full` against Amazon's RDS bundle, Redis `rediss://`, mail `smtps://` |

Refused on purpose: SHA-1 in SAML signatures and digests (refused before checking), any JWT algorithm but ES256, RSA keys under 2048 bits, and MD5 anywhere.

## Rotations

| Date | Key | Environment | By | Why |
|---|---|---|---|---|
| | | | | |
