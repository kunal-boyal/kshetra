-- Recording and adjusting forecasts (decision D126). The tenant admin holds every permission and
-- no one may edit its role, so existing tenants' admins take the new ones here.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['forecast.record', 'forecast.adjust']
 WHERE "key" = 'tenant_admin'
   AND NOT ('forecast.record' = ANY ("permissions"));
