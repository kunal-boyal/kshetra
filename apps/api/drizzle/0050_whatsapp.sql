ALTER TYPE "cell"."notification_channel" ADD VALUE 'whatsapp';--> statement-breakpoint
CREATE TABLE "cell"."whatsapp_consents" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opted_in" boolean NOT NULL,
	"version" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "whatsapp_consents_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."whatsapp_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."whatsapp_consents" ADD CONSTRAINT "whatsapp_consents_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."whatsapp_consents" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);