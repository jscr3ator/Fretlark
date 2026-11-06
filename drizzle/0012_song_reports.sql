CREATE TABLE IF NOT EXISTS `song_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`share_token` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`ip_hash` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `song_reports_status_idx` ON `song_reports` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `song_reports_ip_idx` ON `song_reports` (`ip_hash`,`created_at`);
