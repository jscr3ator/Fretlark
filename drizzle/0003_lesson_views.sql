ALTER TABLE `lessons` ADD `view_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `last_viewed_at` text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lesson_views` (
	`lesson_id` text NOT NULL,
	`day` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`lesson_id`, `day`)
);
