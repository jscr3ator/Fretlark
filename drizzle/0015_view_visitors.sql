CREATE TABLE IF NOT EXISTS `lesson_view_visitors` (
	`lesson_id` text NOT NULL,
	`day` text NOT NULL,
	`visitor` text NOT NULL,
	PRIMARY KEY(`lesson_id`, `day`, `visitor`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `lesson_view_visitors_day_idx` ON `lesson_view_visitors` (`day`);
