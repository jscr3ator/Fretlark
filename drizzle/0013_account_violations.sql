CREATE TABLE IF NOT EXISTS `account_violations` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`reason` text NOT NULL,
	`report_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_violations_teacher_idx` ON `account_violations` (`teacher_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_violations_lesson_idx` ON `account_violations` (`lesson_id`);
