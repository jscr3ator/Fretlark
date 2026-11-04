ALTER TABLE teachers ADD COLUMN mfa_secret TEXT;
ALTER TABLE teachers ADD COLUMN mfa_pending_secret TEXT;
ALTER TABLE teachers ADD COLUMN mfa_pending_expires INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT -1;
ALTER TABLE teachers ADD COLUMN mfa_recovery_codes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE teacher_sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teacher_sessions ADD COLUMN elevated_until INTEGER NOT NULL DEFAULT 0;
CREATE TABLE auth_challenges (
 token_hash TEXT PRIMARY KEY NOT NULL,
 teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
 password_hash TEXT NOT NULL,
 mfa_secret TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE INDEX auth_challenges_teacher ON auth_challenges(teacher_id);
