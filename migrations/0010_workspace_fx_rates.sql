CREATE TABLE `workspace_fx_rates` (
	`currency` text PRIMARY KEY NOT NULL,
	`home_currency` text NOT NULL,
	`rate` text NOT NULL,
	`rate_scaled` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
