ALTER TYPE "cell"."day_status" ADD VALUE 'paid_leave' BEFORE 'absent';--> statement-breakpoint
ALTER TYPE "cell"."day_status" ADD VALUE 'unpaid_leave' BEFORE 'absent';--> statement-breakpoint
ALTER TYPE "cell"."day_status" ADD VALUE 'holiday' BEFORE 'absent';--> statement-breakpoint
ALTER TYPE "cell"."day_status" ADD VALUE 'weekly_off' BEFORE 'absent';--> statement-breakpoint
CREATE TABLE "cell"."calendars" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"weekly_offs" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calendars_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "cell"."calendars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."holidays" (
	"tenant_id" uuid NOT NULL,
	"calendar_key" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_tenant_id_calendar_key_date_pk" PRIMARY KEY("tenant_id","calendar_key","date")
);
--> statement-breakpoint
ALTER TABLE "cell"."holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."regularisations" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "regularisations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "regularisations_status" CHECK ("cell"."regularisations"."status" in ('present', 'half_day')),
	CONSTRAINT "regularisations_state" CHECK ("cell"."regularisations"."state" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "cell"."regularisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."users" ADD COLUMN "calendar_key" text;--> statement-breakpoint
ALTER TABLE "cell"."holidays" ADD CONSTRAINT "holidays_calendar_fk" FOREIGN KEY ("tenant_id","calendar_key") REFERENCES "cell"."calendars"("tenant_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."regularisations" ADD CONSTRAINT "regularisations_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_tenant_default" ON "cell"."calendars" USING btree ("tenant_id") WHERE "cell"."calendars"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "regularisations_one_open" ON "cell"."regularisations" USING btree ("tenant_id","user_id","date") WHERE "cell"."regularisations"."state" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "regularisations_tenant_user_date" ON "cell"."regularisations" USING btree ("tenant_id","user_id","date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."calendars" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."holidays" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."regularisations" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);