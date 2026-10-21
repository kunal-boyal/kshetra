CREATE TYPE "cell"."export_status" AS ENUM('queued', 'running', 'ready', 'failed', 'expired');--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'export.finished';--> statement-breakpoint
CREATE TABLE "cell"."export_jobs" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report" text NOT NULL,
	"filters" jsonb NOT NULL,
	"format" text NOT NULL,
	"locale" text NOT NULL,
	"status" "cell"."export_status" DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"file_media_id" uuid,
	"file_name" text,
	"error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "export_jobs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."export_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."export_jobs" ADD CONSTRAINT "export_jobs_file_fk" FOREIGN KEY ("tenant_id","file_media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."export_jobs" ADD CONSTRAINT "export_jobs_user_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_user_created" ON "cell"."export_jobs" USING btree ("tenant_id","created_by","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_expires" ON "cell"."export_jobs" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."export_jobs" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);