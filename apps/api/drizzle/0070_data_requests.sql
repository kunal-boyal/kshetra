ALTER TYPE "cell"."media_kind" ADD VALUE 'personal_export';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'data_request.received';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'data_request.due_soon';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'data_request.closed';--> statement-breakpoint
CREATE TABLE "cell"."data_requests" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"response" text,
	"self" boolean NOT NULL,
	"raised_by_name" text NOT NULL,
	"due_on" date NOT NULL,
	"archive_status" text,
	"archive_media_id" uuid,
	"archive_size" bigint,
	"archive_sha256" text,
	"archive_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_name" text,
	CONSTRAINT "data_requests_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."data_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."data_requests" ADD CONSTRAINT "data_requests_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."data_requests" ADD CONSTRAINT "data_requests_archive_fk" FOREIGN KEY ("tenant_id","archive_media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_requests_tenant_status_due" ON "cell"."data_requests" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "data_requests_tenant_user" ON "cell"."data_requests" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."data_requests" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);