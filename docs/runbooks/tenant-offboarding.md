# Tenant offboarding

When a customer leaves (spec 10.3, decision D95): tenant deletion and the retention jobs are the only hard deletes.

1. **Confirm in writing** with the customer's authorised contact. Give the date the account closes and the date their data is deleted, 30 days after termination.
2. **Suspend** the tenant in the console (tenant page › Suspend, with the reason). Nobody can sign in from then on (`TENANT_SUSPENDED`), and nothing is deleted yet.
3. **Terminate** it, on the tenant page › Termination › Terminate, with the reason and its slug typed again.
   - The tenant stays closed.
   - A final export of everything it holds is prepared straight away, as the signed archive tenant admins can ask for themselves (D95).
   - The date its data will be deleted appears on the tenant page.
4. **Send the export** once it shows Ready:
   - Use **Copy a download link** and send the link to the customer's contact. Each link lasts 24 hours, and each copy is recorded in the tenant's audit log as vendor staff.
   - The archive is kept 7 days. **Prepare another export** if the customer needs one after that.
   - Customers can check the archive's signature against the public key of the tenant's cell, which `pnpm archive public-key` prints.
5. **Undo** if the customer changes their mind before the deletion date: Termination › Undo termination. The tenant is suspended again with nothing deleted, and Reactivate opens it.
6. **Deletion** happens on its own, 30 days after termination. An hourly job on the tenant's cell:
   - erases every row and file the tenant holds in its cell, its audit log included;
   - removes its people's memberships and sessions, its single sign-on, and anyone left belonging to no other organisation;
   - keeps the tenant's row, billing account, subscriptions, invoices and payments, which GST law requires;
   - records a deletion certificate (`tenant.deleted`) in the platform audit, counting what went.

   The tenant page then shows when its data was deleted.
7. **Backups** age out with RDS's 14-day recovery window and the snapshots' retention. Record when the last copy expires.
