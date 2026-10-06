-- The audit log (module M21, spec 10.3), partitioned by month so retention drops whole months
-- (spec 10.4, D9). Drizzle can't declare partitioned tables, so this migration does; the
-- table's Drizzle definition lives in src/db/audit-log.ts, outside what drizzle-kit reads.
CREATE TYPE "cell"."audit_actor_kind" AS ENUM('user', 'platform', 'system', 'api_client');
--> statement-breakpoint
CREATE TABLE "cell"."audit_log" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_kind" "cell"."audit_actor_kind" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"device_id" uuid,
	"support_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_pk" PRIMARY KEY ("tenant_id", "created_at", "id")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE INDEX "audit_log_target" ON "cell"."audit_log" ("tenant_id", "target_type", "target_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "cell"."audit_log" ("tenant_id", "actor_id", "created_at");
--> statement-breakpoint
ALTER TABLE "cell"."audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."audit_log" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
-- Append-only for the application: it may add entries and read them, never change or remove them.
REVOKE UPDATE, DELETE, TRUNCATE ON "cell"."audit_log" FROM "cell_app";
--> statement-breakpoint
-- Creates this month's partition and the next two, each with the parent's row-level security and
-- append-only grants, since partitions don't inherit either. It runs as its owner, the migrator,
-- so the API and the relay can call it without being able to create tables themselves.
CREATE FUNCTION "cell"."ensure_audit_log_partitions"() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  month_start timestamp;
  partition_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cell.audit_log partitions', 0));
  FOR ahead IN 0..2 LOOP
    -- Months are counted in UTC, so the boundaries never move with a session's time zone.
    month_start := date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => ahead);
    partition_name := format('audit_log_y%s', to_char(month_start, 'YYYY"m"MM'));
    IF to_regclass(format('cell.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE cell.%I PARTITION OF cell.audit_log FOR VALUES FROM (%L) TO (%L)',
        partition_name,
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
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."ensure_audit_log_partitions"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."ensure_audit_log_partitions"() TO "cell_app";
--> statement-breakpoint
SELECT "cell"."ensure_audit_log_partitions"();
--> statement-breakpoint
-- The outbox relay looks across tenants for events that are due. It sees only tenant and event
-- IDs; it then delivers each event inside that tenant's own row-level security context.
CREATE FUNCTION "cell"."due_outbox_events"(batch integer) RETURNS TABLE (tenant_id uuid, id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT e.tenant_id, e.id
    FROM cell.outbox_events e
   WHERE e.dispatched_at IS NULL AND e.next_attempt_at <= now()
   ORDER BY e.next_attempt_at, e.created_at
   LIMIT least(greatest(batch, 1), 500)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."due_outbox_events"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."due_outbox_events"(integer) TO "cell_app";
--> statement-breakpoint
-- Retention for the outbox module's tables (spec 10.3, 10.4): delivered events after 3 days, and
-- idempotency keys after 7.
CREATE FUNCTION "cell"."purge_outbox_and_idempotency_keys"() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  DELETE FROM cell.outbox_events WHERE dispatched_at < now() - interval '3 days';
  DELETE FROM cell.idempotency_keys WHERE created_at < now() - interval '7 days';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."purge_outbox_and_idempotency_keys"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."purge_outbox_and_idempotency_keys"() TO "cell_app";
