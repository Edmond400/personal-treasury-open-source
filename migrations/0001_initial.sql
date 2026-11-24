PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS treasury_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, setup_json TEXT NOT NULL);
INSERT OR IGNORE INTO treasury_meta VALUES (1,0,'null');
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS balance_snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS obligations (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS policy_versions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS monthly_settlements (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS audit_log (
  revision INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL, recorded_at TEXT NOT NULL,
  before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, details TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit is immutable'); END;
CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS archived_audit_log (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TRIGGER IF NOT EXISTS archive_no_update BEFORE UPDATE ON archived_audit_log BEGIN SELECT RAISE(ABORT, 'archived audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS archive_no_delete BEFORE DELETE ON archived_audit_log BEGIN SELECT RAISE(ABORT, 'archived audit is immutable'); END;
