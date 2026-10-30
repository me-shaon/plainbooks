ALTER TABLE `workspace` ADD `update_check` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `latest_version` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `latest_release_url` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `update_checked_at` integer;