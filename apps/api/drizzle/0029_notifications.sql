CREATE TYPE "cell"."delivery_status" AS ENUM('queued', 'held', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "cell"."notification_category" AS ENUM('plan', 'approvals', 'review', 'targets', 'tracking', 'imports');--> statement-breakpoint
CREATE TYPE "cell"."notification_channel" AS ENUM('in_app', 'push', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "cell"."notification_event" AS ENUM('plan.today', 'approval.waiting', 'approval.decided', 'submission.rejected', 'target.locked', 'tracking.stopped', 'tracking.stopped_report', 'import.finished');--> statement-breakpoint
CREATE TABLE "cell"."notification_deliveries" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "cell"."notification_channel" NOT NULL,
	"status" "cell"."delivery_status" NOT NULL,
	"address" text,
	"provider_ref" text,
	"error" text,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."notification_prefs" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "cell"."notification_category" NOT NULL,
	"muted" boolean NOT NULL,
	CONSTRAINT "notification_prefs_tenant_id_user_id_category_pk" PRIMARY KEY("tenant_id","user_id","category")
);
--> statement-breakpoint
ALTER TABLE "cell"."notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."notifications" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" "cell"."notification_event" NOT NULL,
	"category" "cell"."notification_category" NOT NULL,
	"values" jsonb NOT NULL,
	"link" text,
	"dedupe_key" text NOT NULL,
	"inbox" boolean DEFAULT true NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."push_tokens" (
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_tenant_id_device_id_pk" PRIMARY KEY("tenant_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."push_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_fk" FOREIGN KEY ("tenant_id","notification_id") REFERENCES "cell"."notifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."notification_prefs" ADD CONSTRAINT "notification_prefs_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."push_tokens" ADD CONSTRAINT "push_tokens_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "cell"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."push_tokens" ADD CONSTRAINT "push_tokens_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_notification" ON "cell"."notification_deliveries" USING btree ("tenant_id","notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_user_dedupe" ON "cell"."notifications" USING btree ("tenant_id","user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_created" ON "cell"."notifications" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_unread" ON "cell"."notifications" USING btree ("tenant_id","user_id") WHERE "cell"."notifications"."read_at" is null and "cell"."notifications"."inbox";--> statement-breakpoint
CREATE INDEX "push_tokens_tenant_user" ON "cell"."push_tokens" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."notification_deliveries" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."notification_prefs" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."notifications" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."push_tokens" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);