CREATE TYPE "cell"."target_status" AS ENUM('draft', 'locked');--> statement-breakpoint
CREATE TABLE "cell"."metric_definitions" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"targetable" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_definitions_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "cell"."metric_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."account_plans" (
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "account_plans_tenant_id_account_id_period_metric_key_pk" PRIMARY KEY("tenant_id","account_id","period","metric_key")
);
--> statement-breakpoint
ALTER TABLE "cell"."account_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."target_lines" (
	"tenant_id" uuid NOT NULL,
	"target_set_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	CONSTRAINT "target_lines_tenant_id_target_set_id_metric_key_pk" PRIMARY KEY("tenant_id","target_set_id","metric_key")
);
--> statement-breakpoint
ALTER TABLE "cell"."target_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."target_sets" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" "cell"."target_status" DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "target_sets_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."target_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."account_plans" ADD CONSTRAINT "account_plans_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."target_lines" ADD CONSTRAINT "target_lines_set_fk" FOREIGN KEY ("tenant_id","target_set_id") REFERENCES "cell"."target_sets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."target_sets" ADD CONSTRAINT "target_sets_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "target_sets_tenant_user_period" ON "cell"."target_sets" USING btree ("tenant_id","user_id","period");--> statement-breakpoint
CREATE INDEX "target_sets_tenant_period" ON "cell"."target_sets" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."metric_definitions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."account_plans" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."target_lines" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."target_sets" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);