-- Collections keep the writing transaction's ID on every change, as other synced rows do
-- (decisions D40 and D132), so phones take a collection again whenever its status moves.
CREATE TRIGGER "collections_row_version" BEFORE UPDATE ON "cell"."collections"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
--> statement-breakpoint
-- Collections (decision D132). The tenant admin holds every permission and no one may edit its
-- role, so existing tenants' admins take the new ones here.
UPDATE "cell"."roles"
   SET "permissions" = "permissions" || ARRAY['collection.record', 'collection.view', 'collection.confirm']
 WHERE "key" = 'tenant_admin'
   AND NOT ('collection.view' = ANY ("permissions"));
