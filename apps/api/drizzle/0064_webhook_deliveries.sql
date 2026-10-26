-- The webhook delivery log (spec 10.3, 10.4, decision D94): one row a try, partitioned by month
-- so retention drops whole months. Drizzle can't declare partitioned tables, so this migration
-- does; the table's Drizzle definition lives in src/db/webhook-deliveries.ts.
CREATE TABLE "cell"."webhook_deliveries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"response_code" integer,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_pk" PRIMARY KEY ("tenant_id", "created_at", "id")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_subscription" ON "cell"."webhook_deliveries" ("tenant_id", "subscription_id", "created_at");
--> statement-breakpoint
ALTER TABLE "cell"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."webhook_deliveries" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
-- Append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON "cell"."webhook_deliveries" FROM "cell_app";
--> statement-breakpoint
-- This month's partition and the next two, each with the parent's row-level security and
-- append-only grants, since partitions don't inherit either. It runs as the migrator, so the
-- worker can call it without being able to create tables.
CREATE FUNCTION "cell"."ensure_webhook_delivery_partitions"() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  month_start timestamp;
  partition_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cell.webhook_deliveries partitions', 0));
  FOR ahead IN 0..2 LOOP
    month_start := date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => ahead);
    partition_name := format('webhook_deliveries_y%s', to_char(month_start, 'YYYY"m"MM'));
    IF to_regclass(format('cell.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE cell.%I PARTITION OF cell.webhook_deliveries FOR VALUES FROM (%L) TO (%L)',
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
REVOKE ALL ON FUNCTION "cell"."ensure_webhook_delivery_partitions"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."ensure_webhook_delivery_partitions"() TO "cell_app";
--> statement-breakpoint
-- Drops the months that ended more than `keep_months` ago: the log keeps three months (D94).
CREATE FUNCTION "cell"."drop_old_webhook_delivery_partitions"("keep_months" integer) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  part record;
  cutoff text;
  dropped integer := 0;
BEGIN
  cutoff := format('webhook_deliveries_y%s',
    to_char(date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => keep_months), 'YYYY"m"MM'));
  FOR part IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace
     WHERE n.nspname = 'cell' AND p.relname = 'webhook_deliveries' AND c.relname < cutoff
  LOOP
    EXECUTE format('DROP TABLE cell.%I', part.relname);
    dropped := dropped + 1;
  END LOOP;
  RETURN dropped;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."drop_old_webhook_delivery_partitions"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."drop_old_webhook_delivery_partitions"(integer) TO "cell_app";
--> statement-breakpoint
SELECT "cell"."ensure_webhook_delivery_partitions"();
