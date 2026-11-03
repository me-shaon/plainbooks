CREATE TABLE `retired_email_webhooks` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`provider_id` text NOT NULL,
	`config` text,
	`webhook_secret` text NOT NULL,
	`retired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `retired_email_webhooks_expires_idx` ON `retired_email_webhooks` (`expires_at`);--> statement-breakpoint
ALTER TABLE `email_providers` ADD `connection_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Each saved provider gets its own webhook ID: the provider and 8 random characters.
UPDATE `email_providers` SET `connection_id` = `provider_id` || '-' || lower(hex(randomblob(4)));--> statement-breakpoint
CREATE UNIQUE INDEX `email_providers_connection_id_unique` ON `email_providers` (`connection_id`);