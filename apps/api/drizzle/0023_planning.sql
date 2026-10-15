CREATE TYPE "cell"."plan_item_source" AS ENUM('route', 'adhoc');--> statement-breakpoint
CREATE TYPE "cell"."plan_item_status" AS ENUM('planned', 'visited', 'completed', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "cell"."plan_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "cell"."plan_items" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"purpose" text,
	"note" text,
	"status" "cell"."plan_item_status" DEFAULT 'planned' NOT NULL,
	"source" "cell"."plan_item_source" NOT NULL,
	"route_id" uuid,
	"visit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "plan_items_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."plan_months" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" "cell"."plan_status" DEFAULT 'draft' NOT NULL,
	"approval_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_months_tenant_id_user_id_period_pk" PRIMARY KEY("tenant_id","user_id","period")
);
--> statement-breakpoint
ALTER TABLE "cell"."plan_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."route_accounts" (
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	CONSTRAINT "route_accounts_tenant_id_route_id_account_id_pk" PRIMARY KEY("tenant_id","route_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."route_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."routes" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"recurrence" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "routes_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."plan_items" ADD CONSTRAINT "plan_items_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."plan_items" ADD CONSTRAINT "plan_items_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."plan_items" ADD CONSTRAINT "plan_items_route_fk" FOREIGN KEY ("tenant_id","route_id") REFERENCES "cell"."routes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."plan_items" ADD CONSTRAINT "plan_items_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "cell"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."plan_months" ADD CONSTRAINT "plan_months_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."route_accounts" ADD CONSTRAINT "route_accounts_route_fk" FOREIGN KEY ("tenant_id","route_id") REFERENCES "cell"."routes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."route_accounts" ADD CONSTRAINT "route_accounts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."routes" ADD CONSTRAINT "routes_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_items_tenant_user_date" ON "cell"."plan_items" USING btree ("tenant_id","user_id","date");--> statement-breakpoint
CREATE INDEX "plan_items_tenant_visit" ON "cell"."plan_items" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE INDEX "plan_items_tenant_planned_date" ON "cell"."plan_items" USING btree ("tenant_id","date") WHERE "cell"."plan_items"."status" = 'planned';--> statement-breakpoint
CREATE INDEX "plan_items_tenant_row_version" ON "cell"."plan_items" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_one_per_route_day" ON "cell"."plan_items" USING btree ("tenant_id","route_id","account_id","date") WHERE "cell"."plan_items"."route_id" is not null;--> statement-breakpoint
CREATE INDEX "plan_months_tenant_approval" ON "cell"."plan_months" USING btree ("tenant_id","approval_id");--> statement-breakpoint
CREATE INDEX "route_accounts_tenant_account" ON "cell"."route_accounts" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "routes_tenant_user" ON "cell"."routes" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."plan_items" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."plan_months" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."route_accounts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."routes" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);