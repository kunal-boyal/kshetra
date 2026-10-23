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
