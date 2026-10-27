CREATE TABLE `email_providers` (
	`role` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`preset_id` text,
	`credentials` text NOT NULL,
	`webhook_secret` text,
	`daily_cap` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "email_providers_role" CHECK(role in ('primary', 'fallback')),
	CONSTRAINT "email_providers_daily_cap" CHECK(daily_cap is null or daily_cap > 0)
);
--> statement-breakpoint
ALTER TABLE `email_log` ADD `email_provider` text;--> statement-breakpoint
ALTER TABLE `email_log` ADD `idempotency_key` text;--> statement-breakpoint
-- The mailswitch store tables, copied from mailswitch@0.2.0 dist/stores/d1-schema.sql.
CREATE TABLE IF NOT EXISTS mailswitch_idempotency (
  key TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'not_sent', 'unknown')),
  claim_id TEXT NOT NULL,
  attempts TEXT NOT NULL DEFAULT '[]',
  provider_message_id TEXT,
  claimed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mailswitch_idempotency_expires_at ON mailswitch_idempotency (expires_at);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mailswitch_daily_cap (
  scope TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (scope, bucket_start)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mailswitch_webhook_dedupe (
  key TEXT PRIMARY KEY NOT NULL,
  committed INTEGER NOT NULL DEFAULT 0 CHECK (committed IN (0, 1)),
  expires_at INTEGER NOT NULL,
  lease_id TEXT NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mailswitch_webhook_dedupe_expires_at ON mailswitch_webhook_dedupe (expires_at);
