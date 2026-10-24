CREATE TABLE "cell"."expense_claims" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"policy_key" text NOT NULL,
	"policy_version" integer NOT NULL,
	"expense_date" date NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 3),
	"rate" numeric(18, 2),
	"odometer_open" numeric(12, 1),
	"odometer_close" numeric(12, 1),
	"bill_amount" numeric(18, 2),
	"calculated" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"capped" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"workflow_instance_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"payment_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "expense_claims_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "expense_claims_state" CHECK ("cell"."expense_claims"."state" in ('pending', 'approved', 'rejected', 'cancelled', 'paid'))
);
--> statement-breakpoint
ALTER TABLE "cell"."expense_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."expense_policies" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_policies_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "cell"."expense_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."expense_policy_versions" (
	"tenant_id" uuid NOT NULL,
	"policy_key" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_policy_versions_tenant_id_policy_key_version_pk" PRIMARY KEY("tenant_id","policy_key","version")
);
--> statement-breakpoint
ALTER TABLE "cell"."expense_policy_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."expense_claims" ADD CONSTRAINT "expense_claims_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."expense_claims" ADD CONSTRAINT "expense_claims_version_fk" FOREIGN KEY ("tenant_id","policy_key","policy_version") REFERENCES "cell"."expense_policy_versions"("tenant_id","policy_key","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."expense_policy_versions" ADD CONSTRAINT "expense_policy_versions_policy_fk" FOREIGN KEY ("tenant_id","policy_key") REFERENCES "cell"."expense_policies"("tenant_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_claims_tenant_user_date" ON "cell"."expense_claims" USING btree ("tenant_id","user_id","expense_date");--> statement-breakpoint
CREATE INDEX "expense_claims_tenant_date" ON "cell"."expense_claims" USING btree ("tenant_id","expense_date");--> statement-breakpoint
CREATE INDEX "expense_policy_versions_from" ON "cell"."expense_policy_versions" USING btree ("tenant_id","policy_key","valid_from");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."expense_claims" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."expense_policies" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."expense_policy_versions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);