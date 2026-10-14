DROP INDEX "cell"."plan_months_tenant_approval";--> statement-breakpoint
ALTER TABLE "cell"."plan_months" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_months_tenant_request" ON "cell"."plan_months" USING btree ("tenant_id","request_id");