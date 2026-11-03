CREATE TABLE IF NOT EXISTS content_scopes (id TEXT PRIMARY KEY, course TEXT NOT NULL, allowed INTEGER NOT NULL, parent_id TEXT);
CREATE INDEX IF NOT EXISTS scopes_course ON content_scopes(course);
CREATE TABLE IF NOT EXISTS update_scopes (update_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
DELETE FROM deliveries WHERE sent IS NULL AND (id LIKE 'task:assign-%' OR id LIKE 'module:%' OR id LIKE 'post:%' OR id LIKE 'section:%' OR id LIKE 'deadline:%');
