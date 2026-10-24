CREATE TYPE "directory"."platform_role" AS ENUM('platform_admin', 'implementation', 'support', 'finance');--> statement-breakpoint
CREATE TYPE "directory"."platform_user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "directory"."platform_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "directory"."platform_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"auth_revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "directory"."platform_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "directory"."platform_role" NOT NULL,
	"status" "directory"."platform_user_status" DEFAULT 'invited' NOT NULL,
	"password_hash" text,
	"totp_secret" text,
	"totp_confirmed_at" timestamp with time zone,
	"totp_last_step" bigint,
	"setup_token_hash" text,
	"setup_expires_at" timestamp with time zone,
	"auth_revision" integer DEFAULT 0 NOT NULL,
	"failed_sign_ins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_setup_token_hash_unique" UNIQUE("setup_token_hash")
);
--> statement-breakpoint
ALTER TABLE "directory"."tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "directory"."platform_audit" ADD CONSTRAINT "platform_audit_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."platform_sessions" ADD CONSTRAINT "platform_sessions_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_target_idx" ON "directory"."platform_audit" USING btree ("target_type","target_id","at");--> statement-breakpoint
CREATE INDEX "platform_sessions_family_idx" ON "directory"."platform_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_email_key" ON "directory"."platform_users" USING btree (lower("email"));--> statement-breakpoint
-- The platform audit is append-only (spec 13.2): the directory may add to it, never change it.
REVOKE UPDATE, DELETE ON "directory"."platform_audit" FROM "directory_app";
