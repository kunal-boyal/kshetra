-- `target_lock` leaves the request types (decision D137): 0110 removed the chains that named it,
-- and no request ever had it. PostgreSQL can't drop an enum value, so the type is made again,
-- which rewrites both tables: small ones, a row a chain version and a row a request.
ALTER TABLE "cell"."workflow_definitions" ALTER COLUMN "request_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cell"."workflow_instances" ALTER COLUMN "request_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "cell"."request_type";--> statement-breakpoint
CREATE TYPE "cell"."request_type" AS ENUM('leave', 'regularisation', 'expense', 'order', 'new_account', 'account_location_change', 'journey_plan');--> statement-breakpoint
ALTER TABLE "cell"."workflow_definitions" ALTER COLUMN "request_type" SET DATA TYPE "cell"."request_type" USING "request_type"::"cell"."request_type";--> statement-breakpoint
ALTER TABLE "cell"."workflow_instances" ALTER COLUMN "request_type" SET DATA TYPE "cell"."request_type" USING "request_type"::"cell"."request_type";