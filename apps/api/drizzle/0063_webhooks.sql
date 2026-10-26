CREATE TABLE "cell"."webhook_messages" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_id" uuid,
	"event" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_messages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "webhook_messages_event" UNIQUE("tenant_id","subscription_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."webhook_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."webhook_subscriptions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"description" text,
	"secret_sealed" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "webhook_subscriptions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."webhook_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "webhook_messages_tenant_created" ON "cell"."webhook_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."webhook_messages" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."webhook_subscriptions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);