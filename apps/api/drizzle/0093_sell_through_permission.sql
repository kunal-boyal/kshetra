-- Recording sell-through (decision D124). The tenant admin holds every permission and no one may
-- edit its role, so existing tenants' admins take the new one here.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['sell_through.record']
 WHERE "key" = 'tenant_admin'
   AND NOT ('sell_through.record' = ANY ("permissions"));
