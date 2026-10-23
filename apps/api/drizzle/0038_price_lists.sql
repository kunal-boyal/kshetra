CREATE TYPE "cell"."price_list_scope" AS ENUM('default', 'account_type', 'segment', 'territory', 'account');--> statement-breakpoint
CREATE TABLE "cell"."price_list_items" (
	"tenant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"discount" numeric(7, 4) DEFAULT '0' NOT NULL,
	"removed_at" timestamp with time zone,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "price_list_items_tenant_id_price_list_id_item_id_pk" PRIMARY KEY("tenant_id","price_list_id","item_id"),
	CONSTRAINT "price_list_items_price" CHECK ("cell"."price_list_items"."price" >= 0),
	CONSTRAINT "price_list_items_discount" CHECK ("cell"."price_list_items"."discount" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "cell"."price_list_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."price_lists" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" "cell"."price_list_scope" NOT NULL,
	"targets" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "price_lists_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "price_lists_valid_dates" CHECK ("cell"."price_lists"."valid_to" is null or "cell"."price_lists"."valid_to" >= "cell"."price_lists"."valid_from"),
	CONSTRAINT "price_lists_default_targets" CHECK (("cell"."price_lists"."scope" = 'default') = (cardinality("cell"."price_lists"."targets") = 0))
);
--> statement-breakpoint
ALTER TABLE "cell"."price_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."price_list_items" ADD CONSTRAINT "price_list_items_list_fk" FOREIGN KEY ("tenant_id","price_list_id") REFERENCES "cell"."price_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."price_list_items" ADD CONSTRAINT "price_list_items_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_list_items_tenant_item" ON "cell"."price_list_items" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "price_list_items_tenant_row_version" ON "cell"."price_list_items" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_tenant_name" ON "cell"."price_lists" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."price_list_items" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."price_lists" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);