-- Phones keep their own recent submissions (spec 11.3), and a review changes a submission's
-- status, so every update restamps its row version with the writing transaction's ID.
CREATE TRIGGER "submissions_row_version" BEFORE UPDATE ON "cell"."submissions"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
