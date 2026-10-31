# Data classification

The classes of data the product holds and what each class requires (ASVS 5.0 V14.1.1, V14.1.2; spec 13.1 and 13.3; decisions D69, D95 and D101). A new table, field, file kind or message names its class in the change that adds it. The customer is the data fiduciary for its people's data under the DPDP Act and the vendor its processor.

## Classes

| Class | What it covers | Examples |
|---|---|---|
| **Secret** | Anything that proves identity or opens data | Refresh and access tokens, API client secrets, sign-in codes, staff passwords, TOTP seeds and recovery codes, SSO client secrets and private keys, webhook signing secrets, signed media and download links, every key in [keys-and-crypto.md](keys-and-crypto.md) |
| **Personal: sensitive** | Data about a person that shows where they were, what they look like, or their circumstances | Location points and trails, punch-in selfies, photos that show people, attendance days, leave requests and their reasons, expense claims and receipts, odometer readings, monthly gross and provisional pay (D117), device identifiers and integrity verdicts, personal-data request archives |
| **Personal** | Data that identifies a person at work | Names, phone numbers, emails, employee codes, designations, reporting lines, roles, addresses and IP addresses in sessions and audit entries, WhatsApp consent |
| **Customer confidential** | The tenant's business | Accounts and their contacts, orders, prices and price lists, statements and balances, targets and metrics, form submissions, evidence photos without people, reports and exports, configuration, the tenant's invoices from the vendor |
| **Vendor internal** | How the product runs | Cell health, usage counts, plans, the console's audit, process logs without personal details |
| **Public** | Meant to be read by anyone | The API's OpenAPI document and reference, the JWKS, the archive signing public key, the product's own pages |

**Encoded data takes the class of what it carries.** Access tokens are signed, not encrypted, so their payloads carry only IDs, revisions and scopes (`sub`, `tid`, `sid`, `did`, `scp`, `sg`, `rev`, `sua`), never names, numbers or emails. Sync cursors and paging cursors carry positions and IDs. Webhook payloads carry IDs, keys and statuses only (`webhookData()`), never personal details. Push and SMS texts may name a person or an account, so they are Personal, and go only through the providers listed in [services.md](../services.md).

## What each class requires

| Requirement | Secret | Personal: sensitive | Personal | Customer confidential | Vendor internal | Public |
|---|---|---|---|---|---|---|
| In transit | TLS 1.2 or later, everywhere | Same | Same | Same | Same | Same |
| At rest | Never stored as itself: hashed (digests, scrypt, HMAC) or sealed under `COLUMN_KEY`; keys in Secrets Manager or KMS | KMS: RDS, S3 media under the cell's media key, backups | KMS | KMS | KMS | No requirement |
| Who may read | Its owner, once, when made; never shown again | The person, and people whose scope reaches them (the reporting line, permissions); files only through five-minute signed links after a scope check | Within the tenant, by permission and scope | Within the tenant, by permission and scope | Vendor staff by platform permission | Anyone |
| Tenant isolation | Row-level security and `tenant_id` on every row | Same | Same | Same | Directory plane, staff only | None |
| In logs | Never; `maskToken()` where a token must be named | Never | Masked (`maskPhone()`, `maskEmail()`) or by ID | By ID | Yes | Yes |
| In error reports | Never; `scrub()` removes it | Never | Removed by `scrub()` | IDs only | Yes | Yes |
| Leaving the cell | Never | Only to the customer: exports, data-request archives, its own API clients and webhooks by ID | Push, SMS, WhatsApp and email providers, as message text, and SSO providers by email | The customer's exports, API and webhooks (IDs) | Sentry, CloudWatch | Anyone |
| Caching | `no-store` | `no-store` on the API; media at CloudFront at most five minutes | `no-store` | `no-store`, except the config bundle (`private`, revalidated) | | Cacheable |
| On the phone | Secure store only | The app's database, in the OS sandbox | Same | Same | | |
| Retention | Until replaced or the session ends | Tenant settings: raw location 7 to 90 days, trails up to three years, evidence photos 3 to 60 months (spec 5.1, D69); erased on a person's request (M21) | Until the person is erased or the tenant leaves | Until the tenant leaves; export and deletion at contract end (D95) | 180 days in logs | |
| Changes recorded | Rotations and resets audited | Audited | Audited with before and after | Audited with before and after | Console changes audited | |

## Where the controls live

- Secrets: `src/platform/column-cipher.ts`, `src/platform/passwords.ts`, `modules/directory/secrets.ts`, `ARCHIVE_SECRET_COLUMNS` (kept out of data exports).
- Isolation and scope: `Database.forTenant()`, the `isolation()` policy, `Scopes`, the cross-tenant contract test.
- Media: `MediaService`, `PhotosService`, the five-minute signed links and cache.
- Logs and reports: [logging.md](logging.md), `scrub()`.
- Retention: `locationRetention()`, `LocationArchive`, `PhotosService.expireEvidence()`, `RecordRetention`.
- Answers: every route's response is cut to its declared schema (`ResponseContract`), so a field that isn't in the contract never leaves the API ([field-access.md](field-access.md)).
