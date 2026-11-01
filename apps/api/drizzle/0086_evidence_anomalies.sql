CREATE TYPE "cell"."mock_source" AS ENUM('tracking', 'punch', 'visit', 'form', 'photo');--> statement-breakpoint
ALTER TYPE "cell"."submission_flag" ADD VALUE 'photo_far';--> statement-breakpoint
ALTER TYPE "cell"."submission_flag" ADD VALUE 'fast_travel';--> statement-breakpoint
ALTER TYPE "cell"."submission_flag" ADD VALUE 'burst';--> statement-breakpoint
ALTER TYPE "cell"."submission_flag" ADD VALUE 'off_shift';--> statement-breakpoint
ALTER TYPE "cell"."submission_flag" ADD VALUE 'mock_history';--> statement-breakpoint
CREATE TABLE "cell"."mock_location_reports" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"seen_at" timestamp with time zone NOT NULL,
	"source" "cell"."mock_source" NOT NULL,
	"count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_location_reports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "mock_location_reports_count" CHECK ("cell"."mock_location_reports"."count" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "cell"."mock_location_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD COLUMN "flag_notes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."mock_location_reports" ADD CONSTRAINT "mock_location_reports_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."mock_location_reports" ADD CONSTRAINT "mock_location_reports_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "cell"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mock_location_reports_tenant_user_seen" ON "cell"."mock_location_reports" USING btree ("tenant_id","user_id","seen_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."mock_location_reports" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);