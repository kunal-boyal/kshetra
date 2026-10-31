CREATE TABLE "cell"."payroll_gross" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_period" text NOT NULL,
	"monthly_gross" numeric(18, 2) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_gross_tenant_id_user_id_from_period_pk" PRIMARY KEY("tenant_id","user_id","from_period"),
	CONSTRAINT "payroll_gross_period" CHECK ("cell"."payroll_gross"."from_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_gross_positive" CHECK ("cell"."payroll_gross"."monthly_gross" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cell"."payroll_gross" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."payroll_gross" ADD CONSTRAINT "payroll_gross_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."payroll_gross" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);