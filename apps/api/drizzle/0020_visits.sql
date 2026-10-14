CREATE TYPE "cell"."geofence_result" AS ENUM('inside', 'outside', 'unknown');--> statement-breakpoint
CREATE TYPE "cell"."submission_flag" AS ENUM('outside_geofence', 'gallery_photo', 'duplicate_photo', 'clock_skew');--> statement-breakpoint
CREATE TYPE "cell"."submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "cell"."visit_end_reason" AS ENUM('check_out', 'next_check_in', 'punch_out', 'idle');--> statement-breakpoint
CREATE TABLE "cell"."submissions" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid,
	"visit_id" uuid,
	"account_id" uuid,
	"form_id" uuid NOT NULL,
	"form_version" integer NOT NULL,
	"device_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"point" geography(Point, 4326) NOT NULL,
	"accuracy" real NOT NULL,
	"gps_at" timestamp with time zone NOT NULL,
	"mocked" boolean NOT NULL,
	"data" jsonb NOT NULL,
	"photo_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"signature_strokes" jsonb,
	"signature_media_id" uuid,
	"distance_m" integer,
	"geofence" "cell"."geofence_result",
	"flags" "cell"."submission_flag"[] DEFAULT '{}' NOT NULL,
	"status" "cell"."submission_status" NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "submissions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."visits" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"device_id" uuid,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_in_point" geography(Point, 4326) NOT NULL,
	"check_in_accuracy" real NOT NULL,
	"distance_m" integer,
	"geofence" "cell"."geofence_result" NOT NULL,
	"check_out_at" timestamp with time zone,
	"check_out_point" geography(Point, 4326),
	"check_out_accuracy" real,
	"end_reason" "cell"."visit_end_reason",
	"clock_skew" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "cell"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "cell"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_form_version_fk" FOREIGN KEY ("tenant_id","form_id","form_version") REFERENCES "cell"."form_versions"("tenant_id","form_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_signature_fk" FOREIGN KEY ("tenant_id","signature_media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD CONSTRAINT "submissions_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "cell"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."visits" ADD CONSTRAINT "visits_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."visits" ADD CONSTRAINT "visits_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "cell"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."visits" ADD CONSTRAINT "visits_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."visits" ADD CONSTRAINT "visits_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "cell"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_tenant_user_captured" ON "cell"."submissions" USING btree ("tenant_id","user_id","captured_at");--> statement-breakpoint
CREATE INDEX "submissions_tenant_status_captured" ON "cell"."submissions" USING btree ("tenant_id","status","captured_at");--> statement-breakpoint
CREATE INDEX "submissions_tenant_account_captured" ON "cell"."submissions" USING btree ("tenant_id","account_id","captured_at");--> statement-breakpoint
CREATE INDEX "submissions_tenant_visit" ON "cell"."submissions" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE INDEX "submissions_tenant_row_version" ON "cell"."submissions" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE INDEX "submissions_point" ON "cell"."submissions" USING gist ("point");--> statement-breakpoint
CREATE INDEX "visits_tenant_account_check_in" ON "cell"."visits" USING btree ("tenant_id","account_id","check_in_at");--> statement-breakpoint
CREATE INDEX "visits_tenant_user_check_in" ON "cell"."visits" USING btree ("tenant_id","user_id","check_in_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_one_open" ON "cell"."visits" USING btree ("tenant_id","user_id") WHERE "cell"."visits"."check_out_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."submissions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."visits" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);