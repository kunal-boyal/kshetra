CREATE TYPE "cell"."measure_type" AS ENUM('kg', 'L');--> statement-breakpoint
CREATE TABLE "cell"."catalogue_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"units" jsonb NOT NULL,
	"measure_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"rounding" text DEFAULT 'per_unit_first' NOT NULL,
	"item_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cell"."catalogue_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."item_units" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_key" text NOT NULL,
	"factor" numeric(18, 3) NOT NULL,
	"sellable" boolean DEFAULT true NOT NULL,
	CONSTRAINT "item_units_tenant_id_item_id_unit_key_pk" PRIMARY KEY("tenant_id","item_id","unit_key"),
	CONSTRAINT "item_units_factor_positive" CHECK ("cell"."item_units"."factor" > 0)
);
--> statement-breakpoint
ALTER TABLE "cell"."item_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."items" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"pack_label" text,
	"hsn" text,
	"tax_rate" numeric(7, 4) NOT NULL,
	"mrp" numeric(18, 2),
	"base_unit" text NOT NULL,
	"measure_type" "cell"."measure_type",
	"measure_per_base_unit" numeric(18, 6),
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "items_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "items_tax_rate_range" CHECK ("cell"."items"."tax_rate" between 0 and 100),
	CONSTRAINT "items_measure_pair" CHECK (("cell"."items"."measure_type" is null) = ("cell"."items"."measure_per_base_unit" is null))
);
--> statement-breakpoint
ALTER TABLE "cell"."items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."product_categories" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	CONSTRAINT "product_categories_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."products" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "products_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."form_versions" (
	"tenant_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "form_versions_tenant_id_form_id_version_pk" PRIMARY KEY("tenant_id","form_id","version")
);
--> statement-breakpoint
ALTER TABLE "cell"."form_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."forms" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "forms_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."item_units" ADD CONSTRAINT "item_units_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."items" ADD CONSTRAINT "items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "cell"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."product_categories" ADD CONSTRAINT "product_categories_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "cell"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "cell"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."form_versions" ADD CONSTRAINT "form_versions_form_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "cell"."forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_tenant_code" ON "cell"."items" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "items_tenant_product" ON "cell"."items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_tenant_name" ON "cell"."product_categories" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_name" ON "cell"."products" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "forms_tenant_key" ON "cell"."forms" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."catalogue_settings" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."item_units" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."items" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."product_categories" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."products" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."form_versions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."forms" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);