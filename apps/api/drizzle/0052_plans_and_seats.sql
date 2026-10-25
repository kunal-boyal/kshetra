CREATE TABLE "directory"."plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"price_month" numeric(18, 2) NOT NULL,
	"price_year" numeric(18, 2) NOT NULL,
	"modules" text[] NOT NULL,
	"limits" jsonb NOT NULL,
	"addons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "directory"."tenant_entitlements" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"extra_modules" text[] DEFAULT '{}' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory"."usage_records" (
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"quantity" numeric(24, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_records_tenant_id_period_metric_pk" PRIMARY KEY("tenant_id","period","metric")
);
--> statement-breakpoint
CREATE TABLE "cell"."seat_intervals" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_to" timestamp with time zone,
	CONSTRAINT "seat_intervals_tenant_id_user_id_active_from_pk" PRIMARY KEY("tenant_id","user_id","active_from")
);
--> statement-breakpoint
ALTER TABLE "cell"."seat_intervals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "directory"."tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."usage_records" ADD CONSTRAINT "usage_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."seat_intervals" ADD CONSTRAINT "seat_intervals_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seat_intervals_tenant_period" ON "cell"."seat_intervals" USING btree ("tenant_id","active_from","active_to");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_intervals_one_open" ON "cell"."seat_intervals" USING btree ("tenant_id","user_id") WHERE "cell"."seat_intervals"."active_to" is null;--> statement-breakpoint
ALTER TABLE "directory"."tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "directory"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."seat_intervals" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
-- Everyone active now has been since their record was made, as far as seats can tell (BR-45);
-- history before this release is not known.
INSERT INTO "cell"."seat_intervals" ("tenant_id", "user_id", "active_from")
SELECT "tenant_id", "id", "created_at" FROM "cell"."users" WHERE "status" = 'active';
