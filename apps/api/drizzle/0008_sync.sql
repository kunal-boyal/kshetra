CREATE TABLE "cell"."sync_tombstones" (
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tombstones_tenant_id_entity_entity_id_pk" PRIMARY KEY("tenant_id","entity","entity_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."sync_tombstones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."users" ALTER COLUMN "row_version" SET DEFAULT (pg_current_xact_id()::text)::bigint;--> statement-breakpoint
ALTER TABLE "cell"."territories" ALTER COLUMN "row_version" SET DEFAULT (pg_current_xact_id()::text)::bigint;--> statement-breakpoint
CREATE INDEX "sync_tombstones_tenant_entity_row_version" ON "cell"."sync_tombstones" USING btree ("tenant_id","entity","row_version");--> statement-breakpoint
CREATE INDEX "sync_tombstones_created_at" ON "cell"."sync_tombstones" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "territories_tenant_row_version" ON "cell"."territories" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."sync_tombstones" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
