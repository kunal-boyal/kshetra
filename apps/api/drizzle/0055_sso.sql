CREATE TYPE "directory"."sso_protocol" AS ENUM('oidc', 'saml');--> statement-breakpoint
CREATE TABLE "directory"."sso_connections" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"protocol" "directory"."sso_protocol" NOT NULL,
	"config_sealed" text NOT NULL,
	"domains" text[] NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enforced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;