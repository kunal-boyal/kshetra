-- Syncable rows carry the ID of the transaction that last wrote them (decision D40). Numbers from
-- a sequence are handed out before commit, and commits land in any order, so a pull could move
-- its cursor past a number whose row was not visible yet and never send that row. A pull instead
-- moves its cursor only up to the oldest transaction still running, which is safe for IDs.
CREATE OR REPLACE FUNCTION "cell"."next_row_version"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.row_version := pg_current_xact_id()::text::bigint;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- A row the old sequence numbered above today's transaction IDs would be sent again on every pull
-- until the IDs caught up; the trigger restamps it with this transaction's ID.
UPDATE "cell"."users" SET "row_version" = 0
  WHERE "row_version" >= pg_current_xact_id()::text::bigint;
--> statement-breakpoint
UPDATE "cell"."territories" SET "row_version" = 0
  WHERE "row_version" >= pg_current_xact_id()::text::bigint;
--> statement-breakpoint
DROP SEQUENCE "cell"."row_version";
--> statement-breakpoint
-- Tombstones last 35 days; a cursor older than 28 days takes a full copy instead (decision D40).
CREATE FUNCTION "cell"."purge_sync_tombstones"() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  DELETE FROM cell.sync_tombstones WHERE created_at < now() - interval '35 days';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."purge_sync_tombstones"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."purge_sync_tombstones"() TO "cell_app";
