-- Phones keep their own plan items (spec 11.3), whose status moves as they are visited and
-- reviewed, so every update restamps their row version with the writing transaction's ID.
CREATE TRIGGER "plan_items_row_version" BEFORE UPDATE ON "cell"."plan_items"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
