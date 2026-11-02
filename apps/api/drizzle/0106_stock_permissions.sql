-- Stock levels keep the writing transaction's ID on every change, as other synced rows do
-- (decisions D40 and D130), so phones take a level again whenever it moves.
CREATE TRIGGER "stock_levels_row_version" BEFORE UPDATE ON "cell"."stock_levels"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
--> statement-breakpoint
-- Distributors' stock (decision D130). The tenant admin holds every permission and no one may edit
-- its role, so existing tenants' admins take the new ones here.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['stock.view', 'stock.record', 'stock.count']
 WHERE "key" = 'tenant_admin'
   AND NOT ('stock.view' = ANY ("permissions"));
