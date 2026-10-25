-- `metric.record` (decision D94): loading external metric values. Every role that defines metrics
-- may load their values too, as the templates' admins and business heads now do. Tenants' config
-- versions move, so the apps fetch the new permission with their bundles.
UPDATE "cell"."roles"
   SET "permissions" = array_append("permissions", 'metric.record')
 WHERE 'metric.manage' = ANY ("permissions")
   AND NOT 'metric.record' = ANY ("permissions");
--> statement-breakpoint
UPDATE "cell"."tenant_settings"
   SET "config_version" = "config_version" + 1,
       "updated_at" = now()
 WHERE "tenant_id" IN (
   SELECT DISTINCT "tenant_id" FROM "cell"."roles" WHERE 'metric.record' = ANY ("permissions")
 );
