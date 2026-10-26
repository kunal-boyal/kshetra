# Incident response

For anything that stops people working or puts data at risk (spec 14.6).

1. **Acknowledge** the alarm or report, and name one person as the lead. Open an incident record: what, since when, who is affected.
2. **Assess severity:**
   - **Sev 1:** sign-in, punch-in or sync is down for a tenant, or data may have leaked.
   - **Sev 2:** a feature is broken, or the service is slow, for many people.
   - **Sev 3:** anything else.
3. **Stabilise first:** roll back a recent deploy ([rollback](rollback.md)), switch the SMS provider ([OTP outage](otp-provider-outage.md)), or scale the services. Phones keep working offline and upload later, so a short outage loses nothing.
4. **Tell customers** for Sev 1 and 2: their admins, by email, within 30 minutes. Say what is affected, what they can do (keep working, the app uploads later), and when the next update comes. Update at least every hour until it is resolved.
5. **Resolve and confirm:** the alarms are quiet, sign-in and sync work, the upload queues drain.
6. **Write it up** within five working days, without blame: the timeline, the cause, what helped and what didn't, and the changes that stop it happening again.

A suspected data leak also needs the customer's notification under India's DPDP Act: involve Kunal at once.
CERT-In's directions of 28 April 2022 ask that the cyber security incidents they list, such as unauthorised access, data breaches and attacks on applications, are reported to CERT-In within six hours of noticing them: involve Kunal at once for those too.

## Finding what happened

Every process writes JSON lines to CloudWatch Logs, in `/<cell>/api`, `/worker`, `/scheduler`, `/migrate` and `/bootstrap`, kept 180 days and encrypted under the cell's logs key (decision D101). The application can't change them, and they keep a copy of the audit trail outside the database.

- **Access lines** (context `HTTP`): `requestId`, `method`, `path` (never the query), `status`, `ms`, `ip`, `tenantId` and `actor` (`user:…`, `api_client:…`, `support:<grant>`, `staff:…`).
- **Security events** (context `Security`), each with the request's ID, address, route, tenant and caller where known:
  - `refused`: a security control said no, with its `code`, such as `FORBIDDEN`, `OUT_OF_SCOPE`, `RATE_LIMITED`, `OTP_INVALID` or `SESSION_REVOKED`;
  - `signed_in`: with its `method` and `factors`;
  - `sign_in_failed`: with a masked `subject` and the `reason`;
  - `reauthentication_failed`;
  - `session_reused`: a spent refresh token came back, so a copy exists and its family was ended;
  - `audit`: every committed audit entry's action, actor and target, without its values.

Each line is `{"level", "timestamp", "context", "message": {…}}`, the event's fields under `message`. In CloudWatch Logs Insights, on the cell's `api` group:

```text
fields @timestamp, message.event, message.code, message.reason, message.subject, message.actor, message.tenantId, message.ip, message.path, message.requestId
| filter context = "Security"
| sort @timestamp desc
```

Add `| filter message.event = "sign_in_failed" | stats count() by message.ip` for guessing from one address, `| filter message.actor = "user:<id>"` for one person, and `| filter message.requestId = "<id>"` to follow one request from the phone's report to its error.

