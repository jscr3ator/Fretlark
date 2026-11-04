CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_limits_expires_at` ON `auth_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `teacher_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `teacher_sessions_teacher_id` ON `teacher_sessions` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `teacher_sessions_expires_at` ON `teacher_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_email_unique` ON `teachers` (`email`);--> statement-breakpoint
ALTER TABLE `lessons` ADD `student_settings` text DEFAULT '{"notation":"both","show_mixer":true,"show_track_controls":true,"metronome":true,"count_in":true,"allow_print":true,"allow_download":true}' NOT NULL;