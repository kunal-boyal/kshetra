ALTER TYPE "cell"."media_kind" ADD VALUE 'tenant_export';--> statement-breakpoint
CREATE TABLE "cell"."data_exports" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"requester_name" text NOT NULL,
	"file_media_id" uuid,
	"file_name" text,
	"size" bigint,
	"sha256" text,
	"table_count" integer,
	"row_count" bigint,
	"file_count" integer,
	"key_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "data_exports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."data_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."data_exports" ADD CONSTRAINT "data_exports_file_fk" FOREIGN KEY ("tenant_id","file_media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."data_exports" ADD CONSTRAINT "data_exports_user_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_exports_tenant_created" ON "cell"."data_exports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."data_exports" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);