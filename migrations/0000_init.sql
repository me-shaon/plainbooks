CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`client_id` text,
	`type` text NOT NULL,
	`actor_user_id` text,
	`data` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_document_idx` ON `activity` (`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_client_idx` ON `activity` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_billing` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_contacts_client_idx` ON `client_contacts` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_contacts_one_primary_uq` ON `client_contacts` (`client_id`) WHERE is_primary = 1;--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`billing_address` text,
	`tax_id` text,
	`default_currency` text DEFAULT 'BDT' NOT NULL,
	`default_tax_rate_id` text,
	`payment_terms_days` integer,
	`template_id` text,
	`reminder_mode` text DEFAULT 'inherit' NOT NULL,
	`recurring_send_mode` text DEFAULT 'inherit' NOT NULL,
	`notes` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`default_tax_rate_id`) REFERENCES `tax_rates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `clients_name_idx` ON `clients` (`name`);--> statement-breakpoint
CREATE INDEX `clients_archived_idx` ON `clients` (`archived_at`);--> statement-breakpoint
CREATE TABLE `counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`scope` text NOT NULL,
	`section` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `custom_field_defs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_values_field_entity_uq` ON `custom_field_values` (`field_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `custom_field_values_entity_idx` ON `custom_field_values` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `document_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`quantity` text DEFAULT '1' NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tax_rate_id`) REFERENCES `tax_rates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `document_lines_document_idx` ON `document_lines` (`document_id`,`position`);--> statement-breakpoint
CREATE TABLE `document_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`snapshot` text NOT NULL,
	`pdf_key` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`client_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text,
	`currency` text NOT NULL,
	`subtotal` integer NOT NULL,
	`discount_total` integer NOT NULL,
	`tax_total` integer NOT NULL,
	`total` integer NOT NULL,
	`home_currency` text NOT NULL,
	`fx_rate` text NOT NULL,
	`home_subtotal` integer NOT NULL,
	`home_discount_total` integer NOT NULL,
	`home_tax_total` integer NOT NULL,
	`home_total` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_revisions_doc_number_uq` ON `document_revisions` (`document_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `document_revisions_issue_date_idx` ON `document_revisions` (`issue_date`);--> statement-breakpoint
CREATE INDEX `document_revisions_client_idx` ON `document_revisions` (`client_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`number` text,
	`client_id` text NOT NULL,
	`currency` text NOT NULL,
	`issue_date` text,
	`due_date` text,
	`expiry_date` text,
	`payment_terms_days` integer,
	`discount_type` text DEFAULT 'none' NOT NULL,
	`discount_percent` text,
	`discount_amount` integer,
	`notes` text,
	`footer_text` text,
	`template_id` text,
	`reminder_mode` text DEFAULT 'inherit' NOT NULL,
	`fx_rate` text,
	`fx_rate_scaled` integer,
	`fx_rate_date` text,
	`fx_provider` text,
	`fx_overridden` integer DEFAULT false NOT NULL,
	`public_token` text,
	`current_revision_id` text,
	`revision_count` integer DEFAULT 0 NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`is_overdue` integer DEFAULT false NOT NULL,
	`source_quote_id` text,
	`converted_invoice_id` text,
	`recurring_schedule_id` text,
	`recurring_period_id` text,
	`decided_at` integer,
	`decision_comment` text,
	`finalized_at` integer,
	`sent_at` integer,
	`paid_at` integer,
	`voided_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documents_status_kind" CHECK((kind = 'invoice' and status in ('draft', 'finalized', 'sent', 'partially_paid', 'paid', 'void')) or (kind = 'quote' and status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_public_token_unique` ON `documents` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_kind_number_uq` ON `documents` (`kind`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_recurring_period_uq` ON `documents` (`recurring_schedule_id`,`recurring_period_id`);--> statement-breakpoint
CREATE INDEX `documents_kind_status_idx` ON `documents` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `documents_kind_overdue_idx` ON `documents` (`kind`,`is_overdue`);--> statement-breakpoint
CREATE INDEX `documents_client_idx` ON `documents` (`client_id`);--> statement-breakpoint
CREATE INDEX `documents_issue_date_idx` ON `documents` (`issue_date`);--> statement-breakpoint
CREATE INDEX `documents_due_date_idx` ON `documents` (`due_date`);--> statement-breakpoint
CREATE INDEX `documents_updated_idx` ON `documents` (`updated_at`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`document_id` text,
	`revision_id` text,
	`reminder_offset_days` integer,
	`recipients` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_log_day_idx` ON `email_log` (`day`,`status`);--> statement-breakpoint
CREATE INDEX `email_log_document_idx` ON `email_log` (`document_id`,`kind`);--> statement-breakpoint
CREATE INDEX `email_log_provider_idx` ON `email_log` (`provider_id`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`requested_date` text NOT NULL,
	`rate_date` text NOT NULL,
	`rate` text NOT NULL,
	`rate_scaled` integer NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`base`, `quote`, `requested_date`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`lease_until` integer,
	`lease_owner` text,
	`last_error` text,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_key_unique` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_run_after_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `leases` (
	`name` text PRIMARY KEY NOT NULL,
	`holder` text,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`document_id` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_read_idx` ON `notifications` (`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`kind` text DEFAULT 'payment' NOT NULL,
	`amount` integer NOT NULL,
	`home_amount` integer NOT NULL,
	`paid_on` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payments_amount_positive" CHECK(amount > 0)
);
--> statement-breakpoint
CREATE INDEX `payments_document_idx` ON `payments` (`document_id`);--> statement-breakpoint
CREATE INDEX `payments_paid_on_idx` ON `payments` (`paid_on`);--> statement-breakpoint
CREATE TABLE `recurring_schedule_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`quantity` text DEFAULT '1' NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate_id` text,
	FOREIGN KEY (`schedule_id`) REFERENCES `recurring_schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tax_rate_id`) REFERENCES `tax_rates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recurring_schedule_lines_schedule_idx` ON `recurring_schedule_lines` (`schedule_id`,`position`);--> statement-breakpoint
CREATE TABLE `recurring_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`source_document_id` text,
	`name` text,
	`currency` text NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`anchor_day` integer NOT NULL,
	`next_issue_date` text NOT NULL,
	`last_period_id` text,
	`send_mode` text DEFAULT 'inherit' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`paused_reason` text,
	`payment_terms_days` integer,
	`template_id` text,
	`discount_type` text DEFAULT 'none' NOT NULL,
	`discount_percent` text,
	`discount_amount` integer,
	`notes` text,
	`footer_text` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recurring_schedules_due_idx` ON `recurring_schedules` (`status`,`next_issue_date`);--> statement-breakpoint
CREATE INDEX `recurring_schedules_client_idx` ON `recurring_schedules` (`client_id`);--> statement-breakpoint
CREATE TABLE `revision_tax_totals` (
	`revision_id` text NOT NULL,
	`tax_rate_id` text NOT NULL,
	`document_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`name` text NOT NULL,
	`rate` text NOT NULL,
	`taxable` integer NOT NULL,
	`tax` integer NOT NULL,
	`home_taxable` integer NOT NULL,
	`home_tax` integer NOT NULL,
	PRIMARY KEY(`revision_id`, `tax_rate_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `document_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revision_tax_totals_issue_date_idx` ON `revision_tax_totals` (`issue_date`,`tax_rate_id`);--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rate` text NOT NULL,
	`note` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`layout` text NOT NULL,
	`config` text NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text DEFAULT 'My agency' NOT NULL,
	`home_currency` text DEFAULT 'BDT' NOT NULL,
	`timezone` text DEFAULT 'Asia/Dhaka' NOT NULL,
	`invoice_prefix` text DEFAULT 'INV-' NOT NULL,
	`quote_prefix` text DEFAULT 'Q-' NOT NULL,
	`number_padding` integer DEFAULT 4 NOT NULL,
	`default_payment_terms_days` integer DEFAULT 14 NOT NULL,
	`default_quote_validity_days` integer DEFAULT 30 NOT NULL,
	`default_template_id` text,
	`default_tax_rate_id` text,
	`reminder_mode` text DEFAULT 'suggest' NOT NULL,
	`recurring_send_mode` text DEFAULT 'draft' NOT NULL,
	`reminder_schedule` text DEFAULT '[{"offsetDays":-3},{"offsetDays":0},{"offsetDays":7},{"offsetDays":14},{"offsetDays":21}]' NOT NULL,
	`overdue_reminder_cap` integer DEFAULT 3 NOT NULL,
	`business_name` text,
	`logo_key` text,
	`accent_color` text DEFAULT '#1f5a4e' NOT NULL,
	`font` text DEFAULT 'instrument-sans' NOT NULL,
	`address` text,
	`tax_id` text,
	`bank_details` text,
	`footer_text` text,
	`email_from_name` text,
	`reply_to_email` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "workspace_singleton" CHECK(id = 1)
);
