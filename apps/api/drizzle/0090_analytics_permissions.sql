-- The advanced analytics module's permissions (decision D122). The tenant admin always holds every
-- permission and no one may edit its role, so existing tenants' admins take the two new ones here;
-- every other role gets them only as its tenant decides.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['report.schedule', 'dashboard.manage']
 WHERE "key" = 'tenant_admin'
   AND NOT ('report.schedule' = ANY ("permissions"));
