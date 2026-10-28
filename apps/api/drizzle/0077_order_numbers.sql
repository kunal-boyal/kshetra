CREATE TABLE "cell"."order_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cell"."order_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."orders" ADD COLUMN "number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_number" ON "cell"."orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."order_counters" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);