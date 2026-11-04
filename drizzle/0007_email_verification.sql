ALTER TABLE teachers ADD COLUMN email_verified_at INTEGER;
UPDATE teachers SET email_verified_at=CAST(strftime('%s','now') AS INTEGER)*1000;
CREATE TABLE email_tokens (
 token_hash TEXT PRIMARY KEY,
 teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX email_tokens_teacher ON email_tokens (teacher_id,kind);
