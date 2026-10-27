# Logging

What the product records, where each record goes, who can read it, how long it is kept and what it must never contain (ASVS 5.0 V16.1.1, V16.2.3; spec 13.1; decisions D32, D98 and D101). Every place a log is written is in this table; a new one is added here in the same change. How to search them is in [incident-response.md](../runbooks/incident-response.md).

## Records

| Record | Written by | What it holds | Format | Goes to | Kept | Readable by |
|---|---|---|---|---|---|---|
| Access lines | Every API request (`request-id.ts`, context `HTTP`) | Request ID, method, path without the query, status, duration, the caller's address (`clientAddress()`), tenant, and the caller as `user:`, `api_client:`, `support:<grant>` or `staff:` | JSON line | Standard output, then CloudWatch Logs `/<cell>/api` | 180 days | The AWS account's administrators |
| Security events | `SecurityLog` (`src/platform/security-log.ts`, context `Security`) | `refused` (every refusal in `SECURITY_CODES`, with its code), `signed_in` (method and factors), `sign_in_failed` (masked subject and reason), `reauthentication_failed`, `session_reused`; each with request ID, address, route, tenant and caller | JSON line | `/<cell>/api` | 180 days | The AWS account's administrators |
| Audit mirror | `AuditLog.record()` and `PlatformAudit.record()`, once their transaction commits (`whenCommitted()`) | Every audit entry's action, actor and target, without its before and after values | JSON line, event `audit` | `/<cell>/api` and `/<cell>/worker` | 180 days | The AWS account's administrators |
| Audit log | `AuditLog.record()` in the transaction of each change | Action, actor (with device and support grant), target, address, before and after values | Rows of `cell.audit_log`, partitioned by month, append-only for `cell_app` | The cell's database | The tenant's `auditRetentionYears` (decision D95) | The tenant's admins with `audit.view`, through the audit viewer and its export |
| Platform audit | `PlatformAudit.record()` | Every console change by vendor staff | Rows of `directory.platform_audit` | The directory database | Kept | Platform admins in the console |
| Process logs | Every process | Start, stop, jobs, warnings, errors with their stack | JSON line, contexts by class | `/<cell>/api`, `/worker`, `/scheduler`, `/migrate`, `/bootstrap` | 180 days | The AWS account's administrators; the deploy role reads only `/migrate` and `/bootstrap` |
| Error reports | `reportError()` for 5xx answers and a job's last failed try; the web apps and the phone | Exception, stack, release, environment, request ID; after `scrub()` | Sentry events | Sentry, once a DSN is set | As the Sentry plan keeps events | The vendor's Sentry members |
| Web firewall | AWS WAF on the load balancer | Blocked and counted requests, with authorisation and cookie headers redacted | WAF log JSON | `aws-waf-logs-<cell>` | 180 days | The AWS account's administrators |
| Database logs | RDS | PostgreSQL's errors, slow statements and connections | Text | `/aws/rds/instance/<db>/postgresql` | CloudWatch's setting for RDS | The AWS account's administrators |
| Cell health | `CellHealthReporter` each minute | Counts and ages only, never people | Embedded metric format | CloudWatch metrics, with `CLOUDWATCH_METRICS` | CloudWatch's metric retention | The AWS account's administrators |
| AWS API calls | CloudTrail | Every change to the account | CloudTrail | The organisation's trail, once the company's AWS Organization exists | As the trail sets | The organisation's security account |

Times are UTC: `timestamp` in milliseconds on each line, `timestamptz` in the database. Every line of a request carries its request ID, which the API also returns as `X-Request-Id`, so a person's report reaches its log lines.

## Protection

- The processes write only to standard output; the container's log driver ships it to CloudWatch, which the tasks' role can't write to, change or delete.
- The cell's log groups are encrypted under a KMS key of the cell's own, which CloudWatch may use only for those groups (`infra/modules/cell/services.tf`).
- `cell_app` can insert into the audit log but not update or delete it; retention removes old partitions through `cell.purge_audit_log()`, owned by `migrator`.
- The audit mirror means a database compromise can't erase the record of what changed.
- Logs are kept 180 days in ap-south-1, as CERT-In's directions of April 2022 ask.

## Never in a log

Phone numbers, one-time codes, tokens of any kind, passwords, TOTP seeds or codes, signed URLs, query strings, request or response bodies, sealed column values, or personal details in error reports. A line that must name a number or address uses `maskPhone()` or `maskEmail()` from `@thelamp/shared`, and a token `maskToken()`. Sentry events pass `scrub()` first. Semgrep's rule `thelamp-unmasked-personal-value-in-log` (`tools/semgrep/rules.yml`) refuses logging a phone number, code, token, password or secret as it is.

Locally, `OTP_PROVIDER=console` prints sign-in codes to the API's console on purpose, so people can sign in on a laptop; a live cell refuses that provider.
