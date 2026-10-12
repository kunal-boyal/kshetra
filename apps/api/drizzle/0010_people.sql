CREATE TYPE "cell"."transfer_status" AS ENUM('scheduled', 'applied', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "cell"."user_fields" (
	"tenant_id" uuid NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retired" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "user_fields_tenant_id_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."user_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."user_transfers" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"changes" jsonb NOT NULL,
	"status" "cell"."transfer_status" DEFAULT 'scheduled' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"applied_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "user_transfers_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."user_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."user_transfers" ADD CONSTRAINT "user_transfers_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_transfers_tenant_user" ON "cell"."user_transfers" USING btree ("tenant_id","user_id","effective_date");--> statement-breakpoint
CREATE INDEX "user_transfers_due" ON "cell"."user_transfers" USING btree ("tenant_id","effective_date") WHERE "cell"."user_transfers"."status" = 'scheduled';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."user_fields" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."user_transfers" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);