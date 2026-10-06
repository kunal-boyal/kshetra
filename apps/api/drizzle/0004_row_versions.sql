-- Syncable rows take a new row_version on every update, from the same sequence their insert
-- default uses, so the mobile sync can ask for every row changed since its cursor (spec 10.1).
CREATE FUNCTION "cell"."next_row_version"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.row_version := nextval('cell.row_version');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_row_version" BEFORE UPDATE ON "cell"."users"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
--> statement-breakpoint
CREATE TRIGGER "territories_row_version" BEFORE UPDATE ON "cell"."territories"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
