CREATE TABLE "cell"."leave_requests" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type_key" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"reason" text,
	"attachment_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "leave_requests_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "leave_requests_range" CHECK ("cell"."leave_requests"."end_date" >= "cell"."leave_requests"."start_date"),
	CONSTRAINT "leave_requests_state" CHECK ("cell"."leave_requests"."state" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "cell"."leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."leave_types" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"paid" boolean NOT NULL,
	"annual_quota" numeric(5, 1) NOT NULL,
	"quota_year" text NOT NULL,
	"half_day_allowed" boolean NOT NULL,
	"attachment_after_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_tenant_id_key_pk" PRIMARY KEY("tenant_id","key"),
	CONSTRAINT "leave_types_quota_year" CHECK ("cell"."leave_types"."quota_year" in ('calendar', 'financial'))
);
--> statement-breakpoint
ALTER TABLE "cell"."leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."leave_requests" ADD CONSTRAINT "leave_requests_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."leave_requests" ADD CONSTRAINT "leave_requests_type_fk" FOREIGN KEY ("tenant_id","leave_type_key") REFERENCES "cell"."leave_types"("tenant_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_user_dates" ON "cell"."leave_requests" USING btree ("tenant_id","user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_dates" ON "cell"."leave_requests" USING btree ("tenant_id","start_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."leave_requests" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."leave_types" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);