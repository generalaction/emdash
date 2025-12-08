-- Migration for github_accounts table
CREATE TABLE IF NOT EXISTS "github_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '',
	"avatar_url" text NOT NULL,
	"is_default" integer DEFAULT false NOT NULL,
	"is_active" integer DEFAULT false NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_github_accounts_login" ON "github_accounts" ("login");
CREATE INDEX IF NOT EXISTS "idx_github_accounts_default" ON "github_accounts" ("is_default");
CREATE INDEX IF NOT EXISTS "idx_github_accounts_active" ON "github_accounts" ("is_active");
