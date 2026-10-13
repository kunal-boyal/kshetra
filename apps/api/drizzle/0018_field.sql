CREATE TYPE "cell"."day_status" AS ENUM('future', 'not_employed', 'present', 'half_day', 'absent');--> statement-breakpoint
CREATE TYPE "cell"."location_source" AS ENUM('foreground', 'background');--> statement-breakpoint
CREATE TYPE "cell"."shift_end_reason" AS ENUM('punch_out', 'auto_closed', 'max_length', 'admin');--> statement-breakpoint
CREATE TABLE "cell"."attendance_days" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "cell"."day_status" NOT NULL,
	"value" numeric(3, 1) NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"hours" numeric(5, 2) NOT NULL,
	"source" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_tenant_id_user_id_date_pk" PRIMARY KEY("tenant_id","user_id","date")
);
--> statement-breakpoint
ALTER TABLE "cell"."attendance_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."attendance_policies" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"rule" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cell"."attendance_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."location_points" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"point" geography(Point, 4326) NOT NULL,
	"accuracy" real NOT NULL,
	"speed" real,
	"source" "cell"."location_source" NOT NULL,
	"battery" smallint,
	CONSTRAINT "location_points_tenant_id_captured_at_id_pk" PRIMARY KEY("tenant_id","captured_at","id")
) PARTITION BY RANGE ("captured_at");
--> statement-breakpoint
ALTER TABLE "cell"."location_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."shift_pauses" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"paused_at" timestamp with time zone NOT NULL,
	"resumed_at" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "shift_pauses_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."shift_pauses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."shift_trails" (
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"polyline" text NOT NULL,
	"point_count" integer NOT NULL,
	"kept_count" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"gaps" jsonb NOT NULL,
	"pauses" jsonb NOT NULL,
	"archived_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_trails_tenant_id_shift_id_pk" PRIMARY KEY("tenant_id","shift_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."shift_trails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."shifts" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"start_point" geography(Point, 4326) NOT NULL,
	"start_accuracy" real NOT NULL,
	"consent_version" text NOT NULL,
	"selfie_media_id" uuid,
	"ended_at" timestamp with time zone,
	"end_point" geography(Point, 4326),
	"end_accuracy" real,
	"end_reason" "cell"."shift_end_reason",
	"distance_m" integer,
	"on_duty_seconds" integer,
	"clock_skew" boolean DEFAULT false NOT NULL,
	"compacted_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."user_last_position" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"point" geography(Point, 4326) NOT NULL,
	"accuracy" real NOT NULL,
	"battery" smallint,
	CONSTRAINT "user_last_position_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."user_last_position" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."attendance_days" ADD CONSTRAINT "attendance_days_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."shift_pauses" ADD CONSTRAINT "shift_pauses_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "cell"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."shift_trails" ADD CONSTRAINT "shift_trails_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "cell"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."shifts" ADD CONSTRAINT "shifts_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."shifts" ADD CONSTRAINT "shifts_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "cell"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."shifts" ADD CONSTRAINT "shifts_selfie_fk" FOREIGN KEY ("tenant_id","selfie_media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."user_last_position" ADD CONSTRAINT "user_last_position_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_points_tenant_shift" ON "cell"."location_points" USING btree ("tenant_id","shift_id","captured_at");--> statement-breakpoint
CREATE INDEX "shift_pauses_tenant_shift" ON "cell"."shift_pauses" USING btree ("tenant_id","shift_id","paused_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_pauses_one_open" ON "cell"."shift_pauses" USING btree ("tenant_id","shift_id") WHERE "cell"."shift_pauses"."resumed_at" is null;--> statement-breakpoint
CREATE INDEX "shift_trails_tenant_user_date" ON "cell"."shift_trails" USING btree ("tenant_id","user_id","date");--> statement-breakpoint
CREATE INDEX "shifts_tenant_user_started" ON "cell"."shifts" USING btree ("tenant_id","user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open" ON "cell"."shifts" USING btree ("tenant_id","user_id") WHERE "cell"."shifts"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "shifts_tenant_to_compact" ON "cell"."shifts" USING btree ("tenant_id","ended_at") WHERE "cell"."shifts"."ended_at" is not null and "cell"."shifts"."compacted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."attendance_days" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."attendance_policies" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."location_points" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."shift_pauses" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."shift_trails" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."shifts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."user_last_position" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);