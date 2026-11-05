CREATE UNIQUE INDEX IF NOT EXISTS teachers_contact_email_unique ON teachers (lower(contact_email)) WHERE contact_email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS account_delete_codes (
	teacher_id TEXT PRIMARY KEY NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
	code_hash TEXT NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
