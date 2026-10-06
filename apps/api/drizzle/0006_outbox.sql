CREATE TABLE "cell"."outbox_events" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "outbox_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "outbox_events_due" ON "cell"."outbox_events" USING btree ("next_attempt_at") WHERE "cell"."outbox_events"."dispatched_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."outbox_events" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);