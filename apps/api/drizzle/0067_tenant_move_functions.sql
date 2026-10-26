-- Moving a tenant between cells (decision D95). Rows of past months land in the monthly
-- partitions of the audit log and the webhook delivery log, which a cell makes only from its own
-- first month on: this makes the months a moved tenant's rows need, as the regular functions do.
CREATE FUNCTION "cell"."ensure_month_partitions"("parent" text, "first_at" timestamptz, "last_at" timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  month_start timestamp;
  partition_name text;
BEGIN
  IF parent NOT IN ('audit_log', 'webhook_deliveries') THEN
    RAISE EXCEPTION 'cell.% has no monthly partitions made this way', parent;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(format('cell.%s partitions', parent), 0));
  month_start := date_trunc('month', first_at AT TIME ZONE 'UTC');
  WHILE month_start <= date_trunc('month', last_at AT TIME ZONE 'UTC') LOOP
    partition_name := format('%s_y%s', parent, to_char(month_start, 'YYYY"m"MM'));
    IF to_regclass(format('cell.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE cell.%I PARTITION OF cell.%I FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        parent,
        month_start AT TIME ZONE 'UTC',
        (month_start + interval '1 month') AT TIME ZONE 'UTC');
      EXECUTE format('ALTER TABLE cell.%I ENABLE ROW LEVEL SECURITY', partition_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON cell.%I AS PERMISSIVE FOR ALL TO cell_app '
        'USING (tenant_id = current_setting(''app.tenant_id'')::uuid) '
        'WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
        partition_name);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON cell.%I FROM cell_app', partition_name);
    END IF;
    month_start := month_start + interval '1 month';
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."ensure_month_partitions"(text, timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."ensure_month_partitions"(text, timestamptz, timestamptz) TO "cell_app";
--> statement-breakpoint
-- Removes every row a tenant has in this cell: once it has moved to another cell, and later once
-- its termination's 30 days are over (decision D95). Tables go in rounds, each in its own
-- subtransaction, until references no longer hold any back; the append-only tables, which the
-- application can't delete from, go too. The application checks first that the tenant no longer
-- lives here; this function trusts it, so only the move and termination code calls it.
CREATE FUNCTION "cell"."purge_tenant"("p_tenant" uuid) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  remaining text[];
  left_over text[];
  name text;
  removed bigint := 0;
  count bigint;
  round integer := 0;
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO remaining
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cell'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relispartition
     AND EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     );
  WHILE coalesce(array_length(remaining, 1), 0) > 0 LOOP
    round := round + 1;
    IF round > 50 THEN
      RAISE EXCEPTION 'Rows of tenant % still hold references in %', p_tenant, remaining;
    END IF;
    left_over := ARRAY[]::text[];
    FOREACH name IN ARRAY remaining LOOP
      BEGIN
        EXECUTE format('DELETE FROM cell.%I WHERE tenant_id = $1', name) USING p_tenant;
        GET DIAGNOSTICS count = ROW_COUNT;
        removed := removed + count;
      EXCEPTION WHEN foreign_key_violation THEN
        left_over := left_over || name;
      END;
    END LOOP;
    remaining := left_over;
  END LOOP;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."purge_tenant"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."purge_tenant"(uuid) TO "cell_app";
