CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`file_name` text NOT NULL,
	`file_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`track_count` integer DEFAULT 0 NOT NULL,
	`bar_count` integer DEFAULT 0 NOT NULL,
	`tempo` integer DEFAULT 120 NOT NULL,
	`share_token` text,
	`shared` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_share_token_unique` ON `lessons` (`share_token`);