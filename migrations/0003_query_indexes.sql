DROP INDEX `activity_client_idx`;--> statement-breakpoint
DROP INDEX `document_revisions_client_idx`;--> statement-breakpoint
DROP INDEX `documents_kind_status_idx`;--> statement-breakpoint
DROP INDEX `documents_kind_overdue_idx`;--> statement-breakpoint
DROP INDEX `documents_client_idx`;--> statement-breakpoint
DROP INDEX `documents_issue_date_idx`;--> statement-breakpoint
DROP INDEX `documents_due_date_idx`;--> statement-breakpoint
DROP INDEX `documents_updated_idx`;--> statement-breakpoint
CREATE INDEX `documents_kind_status_due_idx` ON `documents` (`kind`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `documents_kind_updated_idx` ON `documents` (`kind`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `documents_overdue_idx` ON `documents` (`kind`,`is_overdue`) WHERE is_overdue = 1;--> statement-breakpoint
CREATE INDEX `documents_client_created_idx` ON `documents` (`client_id`,`created_at`);--> statement-breakpoint
DROP INDEX `email_log_document_idx`;--> statement-breakpoint
CREATE INDEX `email_log_document_idx` ON `email_log` (`document_id`,`kind`,`created_at`);