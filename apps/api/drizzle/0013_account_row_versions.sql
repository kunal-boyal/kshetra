-- Accounts and contacts sync to phones (decision D40), so every update restamps their row
-- version with the writing transaction's ID, as users and territories do.
CREATE TRIGGER "accounts_row_version" BEFORE UPDATE ON "cell"."accounts"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
--> statement-breakpoint
CREATE TRIGGER "contacts_row_version" BEFORE UPDATE ON "cell"."contacts"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
