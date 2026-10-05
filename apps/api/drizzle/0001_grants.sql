-- Who may use which schema (spec 9.5). The roles exist before migrations run: `pnpm db:bootstrap`
-- creates them on local and CI databases, infrastructure creates them in AWS.
-- cell_app reads and writes tenant data, always under row-level security. It never touches directory.
GRANT USAGE ON SCHEMA "cell" TO "cell_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "cell" TO "cell_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "cell" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "cell_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "cell" GRANT USAGE, SELECT ON SEQUENCES TO "cell_app";
--> statement-breakpoint
-- directory_app is the only role allowed into the directory schema.
GRANT USAGE ON SCHEMA "directory" TO "directory_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "directory" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "directory_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "directory" GRANT USAGE, SELECT ON SEQUENCES TO "directory_app";
