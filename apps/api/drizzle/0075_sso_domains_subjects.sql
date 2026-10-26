CREATE TABLE "directory"."sso_domains" (
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_domains_tenant_id_domain_pk" PRIMARY KEY("tenant_id","domain")
);
--> statement-breakpoint
CREATE TABLE "directory"."sso_subjects" (
	"tenant_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_subjects_tenant_id_issuer_subject_pk" PRIMARY KEY("tenant_id","issuer","subject")
);
--> statement-breakpoint
ALTER TABLE "directory"."sso_domains" ADD CONSTRAINT "sso_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."sso_subjects" ADD CONSTRAINT "sso_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."sso_subjects" ADD CONSTRAINT "sso_subjects_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "directory"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_domains_verified" ON "directory"."sso_domains" USING btree ("domain") WHERE "directory"."sso_domains"."verified_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_subjects_member" ON "directory"."sso_subjects" USING btree ("tenant_id","issuer","membership_id");