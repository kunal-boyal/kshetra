-- Schemes keep the writing transaction's ID on every change, as other synced rows do (decisions
-- D40 and D127), so phones take a scheme again whenever it changes.
CREATE TRIGGER "schemes_row_version" BEFORE UPDATE ON "cell"."schemes"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
--> statement-breakpoint
-- Managing schemes (decision D127). The tenant admin holds every permission and no one may edit
-- its role, so existing tenants' admins take the new one here.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['scheme.manage']
 WHERE "key" = 'tenant_admin'
   AND NOT ('scheme.manage' = ANY ("permissions"));
