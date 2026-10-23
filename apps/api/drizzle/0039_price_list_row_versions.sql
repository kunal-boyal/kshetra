-- Price lists and their entries carry the writing transaction's ID, as other synced rows do
-- (decisions D40 and D77), so phones keep the prices that apply to their accounts.
CREATE TRIGGER "price_lists_row_version" BEFORE UPDATE ON "cell"."price_lists"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
--> statement-breakpoint
CREATE TRIGGER "price_list_items_row_version" BEFORE UPDATE ON "cell"."price_list_items"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
