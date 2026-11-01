CREATE TYPE "cell"."schedule_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "cell"."schedule_pause_reason" AS ENUM('by_owner', 'owner_access');--> statement-breakpoint
CREATE TYPE "cell"."schedule_status" AS ENUM('active', 'paused');--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'report.scheduled' BEFORE 'support.requested';--> statement-breakpoint
CREATE TABLE "cell"."report_schedule_recipients" (
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "report_schedule_recipients_tenant_id_schedule_id_user_id_pk" PRIMARY KEY("tenant_id","schedule_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."report_schedule_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."report_schedule_runs" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"send_date" date NOT NULL,
	"period" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedule_runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."report_schedule_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."report_schedules" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"report" text NOT NULL,
	"filters" jsonb NOT NULL,
	"format" text NOT NULL,
	"locale" text NOT NULL,
	"frequency" "cell"."schedule_frequency" NOT NULL,
	"weekday" smallint,
	"at" text NOT NULL,
	"status" "cell"."schedule_status" DEFAULT 'active' NOT NULL,
	"paused_reason" "cell"."schedule_pause_reason",
	"active_from" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "report_schedules_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."report_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."export_jobs" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."export_jobs" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_schedule_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "cell"."report_schedules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."report_schedule_runs" ADD CONSTRAINT "report_schedule_runs_schedule_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "cell"."report_schedules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."report_schedules" ADD CONSTRAINT "report_schedules_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedule_recipients_tenant_user" ON "cell"."report_schedule_recipients" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedule_runs_tenant_schedule_date" ON "cell"."report_schedule_runs" USING btree ("tenant_id","schedule_id","send_date");--> statement-breakpoint
CREATE INDEX "report_schedules_tenant_owner" ON "cell"."report_schedules" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX "report_schedules_tenant_running" ON "cell"."report_schedules" USING btree ("tenant_id") WHERE "cell"."report_schedules"."status" = 'active' and "cell"."report_schedules"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "cell"."export_jobs" ADD CONSTRAINT "export_jobs_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "cell"."report_schedule_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_run" ON "cell"."export_jobs" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."report_schedule_recipients" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."report_schedule_runs" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."report_schedules" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);