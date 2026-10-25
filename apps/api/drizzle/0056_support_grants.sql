CREATE TYPE "directory"."support_scope" AS ENUM('read', 'write');--> statement-breakpoint
ALTER TYPE "cell"."notification_category" ADD VALUE 'support';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'support.requested';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'support.emergency';--> statement-breakpoint
CREATE TABLE "directory"."support_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"scope" "directory"."support_scope" NOT NULL,
	"hours" integer NOT NULL,
	"emergency" boolean DEFAULT false NOT NULL,
	"granted_scope" "directory"."support_scope",
	"approved_by_user_id" uuid,
	"approved_by_staff_id" uuid,
	"approved_by_name" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"closed_by_staff_id" uuid,
	"closed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ALTER COLUMN "membership_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ADD COLUMN "support_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "directory"."support_grants" ADD CONSTRAINT "support_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."support_grants" ADD CONSTRAINT "support_grants_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."support_grants" ADD CONSTRAINT "support_grants_approved_by_staff_id_platform_users_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."support_grants" ADD CONSTRAINT "support_grants_closed_by_staff_id_platform_users_id_fk" FOREIGN KEY ("closed_by_staff_id") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_grants_tenant_idx" ON "directory"."support_grants" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "support_grants_staff_idx" ON "directory"."support_grants" USING btree ("platform_user_id","created_at");--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_support_grant_id_support_grants_id_fk" FOREIGN KEY ("support_grant_id") REFERENCES "directory"."support_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_one_holder" CHECK (("directory"."refresh_tokens"."membership_id" is null) <> ("directory"."refresh_tokens"."support_grant_id" is null));