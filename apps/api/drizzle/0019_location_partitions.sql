-- Raw location points live in daily partitions managed by pg_partman (spec 10.3, decision D47).
-- Partitions are made a week ahead; points outside them land in the default partition. Old
-- partitions are kept until the archive to the object store lands (step 17), so no retention is
-- set here. db:bootstrap installs pg_partman locally and in CI; in AWS, infrastructure does.
SELECT partman.create_parent(
  p_parent_table := 'cell.location_points',
  p_control := 'captured_at',
  p_interval := '1 day',
  p_premake := 7,
  p_jobmon := false
);
--> statement-breakpoint
-- Makes the coming days' partitions, and gives every partition the tenant-isolation policy its
-- parent has: queries go through the parent, but a partition must not be readable on its own.
-- The scheduler calls it every day as cell_app; it runs as the migrator, which owns the tables.
CREATE FUNCTION "cell"."maintain_location_partitions"() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  part regclass;
BEGIN
  PERFORM partman.run_maintenance(p_parent_table := 'cell.location_points', p_jobmon := false);
  FOR part IN
    SELECT c.oid::regclass
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'cell.location_points'::regclass
       AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL TO cell_app '
      || 'USING (tenant_id = current_setting(''app.tenant_id'')::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      part
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."maintain_location_partitions"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."maintain_location_partitions"() TO "cell_app";
--> statement-breakpoint
SELECT "cell"."maintain_location_partitions"();
