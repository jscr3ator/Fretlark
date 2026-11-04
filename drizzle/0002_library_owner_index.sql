CREATE INDEX IF NOT EXISTS lessons_owner_updated ON lessons(owner_id, updated_at DESC);
