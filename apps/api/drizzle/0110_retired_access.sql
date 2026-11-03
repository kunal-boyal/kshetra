-- Permissions nothing ever used are taken out of the catalogue (decision D137). Stored roles,
-- the tenant admin's included, drop them, so a role never holds one the catalogue doesn't know.
-- A role that held nothing else is left holding nothing, for its tenant's admin to look at.
UPDATE "cell"."roles"
   SET "permissions" = array_remove(array_remove("permissions", 'policy.manage'), 'notification_template.manage')
 WHERE "permissions" && ARRAY['policy.manage', 'notification_template.manage'];
--> statement-breakpoint
-- The `target_lock` request type goes too (decision D137): nothing ever made such a request, so
-- only a chain an admin set up for it can exist. Its versions go before the next migration takes
-- the value out of `cell.request_type`. Compared as text, so this reads the same after it.
DELETE FROM "cell"."workflow_definitions" WHERE "request_type"::text = 'target_lock';
