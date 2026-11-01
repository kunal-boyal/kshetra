CREATE TABLE "cell"."pay_adjustments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_adjustments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "pay_adjustments_kind" CHECK ("cell"."pay_adjustments"."kind" in ('earning', 'deduction'))
);
--> statement-breakpoint
ALTER TABLE "cell"."pay_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."pay_runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rate_set_id" text NOT NULL,
	"rules_version" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "pay_runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "pay_runs_status" CHECK ("cell"."pay_runs"."status" in ('draft', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "cell"."pay_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."payslips" (
	"tenant_id" uuid NOT NULL,
	"pay_run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"structure" jsonb NOT NULL,
	"profile" jsonb NOT NULL,
	"paid_halves" integer NOT NULL,
	"scheduled" integer NOT NULL,
	"esi_covered" boolean NOT NULL,
	"figures" jsonb NOT NULL,
	"gross" numeric(18, 2) NOT NULL,
	"tds" numeric(18, 2) NOT NULL,
	"net" numeric(18, 2) NOT NULL,
	CONSTRAINT "payslips_tenant_id_pay_run_id_user_id_pk" PRIMARY KEY("tenant_id","pay_run_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."payslips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."salary_structures" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_period" text NOT NULL,
	"basic" numeric(18, 2) NOT NULL,
	"da" numeric(18, 2) NOT NULL,
	"hra" numeric(18, 2) NOT NULL,
	"conveyance" numeric(18, 2) NOT NULL,
	"special" numeric(18, 2) NOT NULL,
	"others" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_structures_tenant_id_user_id_from_period_pk" PRIMARY KEY("tenant_id","user_id","from_period"),
	CONSTRAINT "salary_structures_period" CHECK ("cell"."salary_structures"."from_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "cell"."salary_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."statutory_profiles" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_state" text,
	"pt_women" boolean DEFAULT false NOT NULL,
	"pf_member" boolean DEFAULT true NOT NULL,
	"pf_full_wage" boolean DEFAULT false NOT NULL,
	"uan" text,
	"esi_number" text,
	"pan_on_file" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_profiles_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."statutory_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."pay_adjustments" ADD CONSTRAINT "pay_adjustments_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."payslips" ADD CONSTRAINT "payslips_run_fk" FOREIGN KEY ("tenant_id","pay_run_id") REFERENCES "cell"."pay_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."payslips" ADD CONSTRAINT "payslips_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."salary_structures" ADD CONSTRAINT "salary_structures_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."statutory_profiles" ADD CONSTRAINT "statutory_profiles_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_adjustments_tenant_period" ON "cell"."pay_adjustments" USING btree ("tenant_id","period","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_runs_tenant_period" ON "cell"."pay_runs" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "payslips_tenant_user_period" ON "cell"."payslips" USING btree ("tenant_id","user_id","period");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."pay_adjustments" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."pay_runs" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."payslips" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."salary_structures" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."statutory_profiles" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);