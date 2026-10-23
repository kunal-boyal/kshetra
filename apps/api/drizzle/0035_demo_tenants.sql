ALTER TYPE "directory"."otp_channel" ADD VALUE 'demo';--> statement-breakpoint
ALTER TABLE "directory"."tenants" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;