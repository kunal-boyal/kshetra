-- Drops a day's partition of raw points once it is empty and ends before `before` (spec 10.3,
-- decision D69). Each tenant's nightly job archives its points and deletes them after its own
-- retention, so a partition empties once every tenant has passed it; one still holding points,
-- because some tenant's archive hasn't run, stays. The scheduler calls it as cell_app; it runs as
-- the migrator, which owns the partitions and sees every tenant's rows. A partition whose lock
-- isn't free within a few seconds is left for the next run.
CREATE FUNCTION "cell"."drop_empty_location_partitions"("before" timestamptz) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  part record;
  ends timestamptz;
  holds boolean;
  dropped integer := 0;
BEGIN
  FOR part IN
    SELECT partition_schemaname AS schema_name, partition_tablename AS table_name
      FROM partman.show_partitions('cell.location_points', 'ASC', false)
  LOOP
    SELECT child_end_time INTO ends
      FROM partman.show_partition_info(format('%I.%I', part.schema_name, part.table_name), NULL, 'cell.location_points');
    EXIT WHEN ends > "before";
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I)', part.schema_name, part.table_name) INTO holds;
    CONTINUE WHEN holds;
    BEGIN
      EXECUTE format('DROP TABLE %I.%I', part.schema_name, part.table_name);
      dropped := dropped + 1;
    EXCEPTION WHEN lock_not_available THEN
      NULL;
    END;
  END LOOP;
  RETURN dropped;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."drop_empty_location_partitions"(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."drop_empty_location_partitions"(timestamptz) TO "cell_app";
