CREATE TABLE "cell"."held_configuration" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"workflows" jsonb NOT NULL,
	"people" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "cell"."held_configuration" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."held_configuration" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);