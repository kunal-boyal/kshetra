-- Invoices and receipts carry the writing transaction's ID, as other synced rows do (decisions D40
-- and D121): a correction moves the row, so phones keep each account's balance as it now stands.
CREATE TRIGGER "invoices_row_version" BEFORE UPDATE ON "cell"."invoices"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();--> statement-breakpoint
CREATE TRIGGER "receipts_row_version" BEFORE UPDATE ON "cell"."receipts"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
