CREATE TYPE "cell"."order_line_decision" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "cell"."order_status" AS ENUM('submitted', 'accepted', 'partially_accepted', 'rejected', 'fulfilled', 'partially_fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "cell"."order_supplier_kind" AS ENUM('company', 'account');--> statement-breakpoint
CREATE TABLE "cell"."order_lines" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"price_list_id" uuid NOT NULL,
	"unit_key" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"factor" numeric(18, 3) NOT NULL,
	"base_units" numeric(18, 3) NOT NULL,
	"measure_type" "cell"."measure_type",
	"measure_total" numeric(18, 3),
	"price" numeric(18, 2) NOT NULL,
	"discount" numeric(7, 4) NOT NULL,
	"tax_rate" numeric(7, 4) NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"taxable" numeric(18, 2) NOT NULL,
	"tax" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"decision" "cell"."order_line_decision" DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"fulfilled_units" numeric(18, 3),
	CONSTRAINT "order_lines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."orders" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"supplier_kind" "cell"."order_supplier_kind" NOT NULL,
	"supplier_account_id" uuid,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"visit_id" uuid,
	"shift_id" uuid,
	"placed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"point" geography(Point, 4326),
	"accuracy" double precision,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_total" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"note" text,
	"photo_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "cell"."order_status" DEFAULT 'submitted' NOT NULL,
	"rejection_reason" text,
	"workflow_instance_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "orders_supplier_pair" CHECK (("cell"."orders"."supplier_kind" = 'account') = ("cell"."orders"."supplier_account_id" is not null)),
	CONSTRAINT "orders_total" CHECK ("cell"."orders"."total" between 0 and 10000000000)
);
--> statement-breakpoint
ALTER TABLE "cell"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ADD CONSTRAINT "order_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "cell"."orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ADD CONSTRAINT "order_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ADD CONSTRAINT "order_lines_price_list_fk" FOREIGN KEY ("tenant_id","price_list_id") REFERENCES "cell"."price_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."orders" ADD CONSTRAINT "orders_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."orders" ADD CONSTRAINT "orders_supplier_fk" FOREIGN KEY ("tenant_id","supplier_account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."orders" ADD CONSTRAINT "orders_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_lines_tenant_order" ON "cell"."order_lines" USING btree ("tenant_id","order_id","position");--> statement-breakpoint
CREATE INDEX "order_lines_tenant_item" ON "cell"."order_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_placed" ON "cell"."orders" USING btree ("tenant_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_account_placed" ON "cell"."orders" USING btree ("tenant_id","account_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_user_placed" ON "cell"."orders" USING btree ("tenant_id","user_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_supplier" ON "cell"."orders" USING btree ("tenant_id","supplier_account_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_row_version" ON "cell"."orders" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE INDEX "orders_point" ON "cell"."orders" USING gist ("point");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."order_lines" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."orders" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);