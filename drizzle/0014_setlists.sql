CREATE TABLE IF NOT EXISTS `setlists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`share_token` text,
	`shared` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `setlists_share_token_idx` ON `setlists` (`share_token`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `setlists_owner_updated_idx` ON `setlists` (`owner_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `setlist_items` (
	`setlist_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`setlist_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `setlist_items_lesson_idx` ON `setlist_items` (`lesson_id`);
