-- Items carry the writing transaction's ID, as other synced rows do (decision D40), ready for the
-- catalogue to sync item by item when prices make it large.
CREATE TRIGGER "items_row_version" BEFORE UPDATE ON "cell"."items"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
