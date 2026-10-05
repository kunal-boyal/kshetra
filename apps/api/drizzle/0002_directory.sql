CREATE TYPE "directory"."cell_kind" AS ENUM('shared', 'dedicated');--> statement-breakpoint
CREATE TYPE "directory"."membership_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "directory"."otp_channel" AS ENUM('sms', 'whatsapp', 'email', 'none');--> statement-breakpoint
CREATE TYPE "directory"."tenant_status" AS ENUM('trial', 'active', 'grace', 'read_only', 'suspended', 'terminated');--> statement-breakpoint
CREATE TABLE "directory"."cells" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"api_base_url" text NOT NULL,
	"kind" "directory"."cell_kind" DEFAULT 'shared' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capacity_users" integer NOT NULL,
	CONSTRAINT "cells_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "directory"."identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "identities_phone_e164_unique" UNIQUE("phone_e164"),
	CONSTRAINT "identities_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "directory"."memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "directory"."membership_status" DEFAULT 'active' NOT NULL,
	"auth_revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "memberships_identity_tenant_key" UNIQUE("identity_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "directory"."otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_key" text NOT NULL,
	"code_hmac" text NOT NULL,
	"channel" "directory"."otp_channel" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory"."refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"auth_revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "directory"."tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "directory"."tenant_status" DEFAULT 'trial' NOT NULL,
	"cell_id" uuid NOT NULL,
	"plan_id" uuid,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "directory"."memberships" ADD CONSTRAINT "memberships_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "directory"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "directory"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."tenants" ADD CONSTRAINT "tenants_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "directory"."cells"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenges_identity_key_idx" ON "directory"."otp_challenges" USING btree ("identity_key","created_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "directory"."refresh_tokens" USING btree ("family_id");