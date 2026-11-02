-- Running payroll and keeping salary structures (decision D128). The tenant admin holds every
-- permission and no one may edit its role, so existing tenants' admins take the new ones here.
-- The module itself stays off until an admin switches it on.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['payroll.run', 'salary.manage']
 WHERE "key" = 'tenant_admin'
   AND NOT ('payroll.run' = ANY ("permissions"));
