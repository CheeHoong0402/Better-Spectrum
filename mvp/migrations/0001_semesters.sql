CREATE TABLE IF NOT EXISTS semesters (id TEXT PRIMARY KEY, definition TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS class_occurrences (class_id TEXT PRIMARY KEY, semester_id TEXT NOT NULL, series_id TEXT NOT NULL, date TEXT NOT NULL, overridden INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0, UNIQUE(semester_id,series_id,date));
CREATE INDEX IF NOT EXISTS occurrences_semester ON class_occurrences(semester_id);
