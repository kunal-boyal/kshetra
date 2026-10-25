CREATE TABLE "directory"."totp_secrets" (
	"identity_id" uuid PRIMARY KEY NOT NULL,
	"secret_sealed" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_step" bigint,
	"recovery_hashes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ADD COLUMN "second_factor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory"."totp_secrets" ADD CONSTRAINT "totp_secrets_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "directory"."identities"("id") ON DELETE no action ON UPDATE no action;