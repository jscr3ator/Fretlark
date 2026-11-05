ALTER TABLE teachers ADD COLUMN contact_email TEXT;
--> statement-breakpoint
ALTER TABLE teachers ADD COLUMN contact_email_verified_at INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX teachers_contact_email_verified ON teachers (contact_email) WHERE contact_email_verified_at IS NOT NULL;
--> statement-breakpoint
CREATE TABLE email_tokens_new (
	id TEXT PRIMARY KEY NOT NULL,
	teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
	token_hash TEXT NOT NULL,
	email TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	used_at INTEGER,
	created_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO email_tokens_new (id,teacher_id,kind,token_hash,email,expires_at,used_at,created_at)
SELECT token_hash,teacher_id,kind,token_hash,COALESCE((SELECT email FROM teachers WHERE teachers.id=email_tokens.teacher_id),''),expires_at,NULL,created_at FROM email_tokens;
--> statement-breakpoint
DROP TABLE email_tokens;
--> statement-breakpoint
ALTER TABLE email_tokens_new RENAME TO email_tokens;
--> statement-breakpoint
CREATE UNIQUE INDEX email_tokens_token_hash ON email_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX email_tokens_teacher ON email_tokens (teacher_id,kind);
