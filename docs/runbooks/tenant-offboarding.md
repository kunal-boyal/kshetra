# Tenant offboarding

When a customer leaves (spec 10.3: tenant deletion is the one hard delete besides retention jobs).

1. **Confirm in writing** with the customer's authorised contact, with the date their data is deleted.
2. **Hand over their data:** exports of the reports they need, and their configuration (Settings › Export and import), within the notice period.
3. **Suspend** the tenant: people can no longer sign in (`TENANT_SUSPENDED`), and nothing is deleted yet.
4. **Delete** after the agreed date: the tenant's rows in every `cell` table, its media objects, and its directory rows. The deletion job arrives with the platform console (phase 3); until then it is a reviewed, one-off script run by two people.
5. Backups age out with RDS's 14-day recovery window and the snapshots' retention; record when the last copy expires.
