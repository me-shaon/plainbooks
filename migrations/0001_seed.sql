-- Seed the single workspace row and the number counters. Column defaults hold the values.
INSERT INTO `workspace` (`id`) VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO `counters` (`name`, `value`) VALUES ('invoice', 0), ('quote', 0) ON CONFLICT DO NOTHING;
