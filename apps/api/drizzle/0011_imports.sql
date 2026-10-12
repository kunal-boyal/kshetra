CREATE TYPE "cell"."import_status" AS ENUM('reading', 'mapping', 'validating', 'ready', 'invalid', 'committing', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "cell"."media_kind" AS ENUM('evidence', 'field_photo', 'selfie', 'attachment', 'receipt', 'odometer', 'signature', 'import_file', 'export_file');--> statement-breakpoint
CREATE TYPE "cell"."media_status" AS ENUM('pending', 'uploaded', 'processed', 'rejected', 'deleted');--> statement-breakpoint
CREATE TABLE "cell"."import_jobs" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target" text NOT NULL,
	"file_media_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"sheets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sheet" text,
	"header_row" integer,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "cell"."import_status" DEFAULT 'reading' NOT NULL,
	"total_rows" integer,
	"error_rows" integer,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created" integer,
	"updated" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."import_mappings" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target" text NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"empty_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mappings_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."import_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."media" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "cell"."media_kind" NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" "cell"."media_status" DEFAULT 'pending' NOT NULL,
	"owner_type" text,
	"owner_id" uuid,
	"retention_class" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."import_jobs" ADD CONSTRAINT "import_jobs_file_fk" FOREIGN KEY ("tenant_id","file_media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."import_jobs" ADD CONSTRAINT "import_jobs_user_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD CONSTRAINT "media_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created" ON "cell"."import_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mappings_tenant_target_name" ON "cell"."import_mappings" USING btree ("tenant_id","target","name");--> statement-breakpoint
CREATE INDEX "media_tenant_sha256" ON "cell"."media" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX "media_tenant_owner" ON "cell"."media" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."import_jobs" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."import_mappings" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."media" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);