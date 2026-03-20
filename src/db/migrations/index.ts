import type { Database } from "better-sqlite3";

/**
 * Quantum Memory - Database Migrations Index
 *
 * All migrations are registered here.
 * Import runMigrations from here in Database.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Run initial schema migration (v1)
 * All tables are created here.
 * This file is the SOURCE OF TRUTH for the schema.
 */
export function runQuantumMigrations(db: Db): void {
  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      last_accessed TEXT,
      metadata TEXT
    )
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
      metadata TEXT,
      UNIQUE (id)
    )
  `);

  // Messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      token_count INTEGER,
      is_compacted INTEGER NOT NULL DEFAULT 0,
      importance_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, id)
    )
  `);

  // Summaries table (DAG nodes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      parent_summary_id TEXT REFERENCES summaries(id) ON DELETE SET NULL,
      level INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      token_count INTEGER,
      source_message_ids TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Entities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT
    )
  `);

  // Relations table (knowledge graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      from_entity TEXT NOT NULL,
      to_entity TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, from_entity, to_entity, relation_type)
    )
  `);

  // Memory inject cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_inject (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      content TEXT NOT NULL,
      source_ids TEXT,
      query TEXT,
      injected_at TEXT DEFAULT (datetime('now')),
      was_useful INTEGER
    )
  `);

  // Drop log
  db.exec(`
    CREATE TABLE IF NOT EXISTS drop_log (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      message_ids TEXT,
      reason TEXT,
      dropped_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Config table
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Schema versions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Large files table
  db.exec(`
    CREATE TABLE IF NOT EXISTS large_files (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      byte_size INTEGER,
      token_count INTEGER,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Summary cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS summary_cache (
      content_hash TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      token_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id, level);
    CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id, type);
    CREATE INDEX IF NOT EXISTS idx_relations_session ON relations(session_id, relation_type);
    CREATE INDEX IF NOT EXISTS idx_inject_session ON memory_inject(session_id);
    CREATE INDEX IF NOT EXISTS idx_inject_at ON memory_inject(injected_at);
    CREATE INDEX IF NOT EXISTS idx_drop_session ON drop_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_drop_at ON drop_log(dropped_at);
    CREATE INDEX IF NOT EXISTS idx_large_files_session ON large_files(session_id);
    CREATE INDEX IF NOT EXISTS idx_large_files_file_id ON large_files(file_id);
    CREATE INDEX IF NOT EXISTS idx_summary_cache_hash ON summary_cache(content_hash);
  `);

  // FTS5 virtual table for full-text search
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid'
      )
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END
    `);
  } catch (ftsError) {
    // FTS5 may not be available on all SQLite builds
  }

  // Record that v1 has been applied
  db.exec(`INSERT OR IGNORE INTO schema_versions (version) VALUES (1)`);
}

interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

const migrations: Migration[] = [
  { version: 1, name: "initial-schema", up: runQuantumMigrations },
];

/**
 * Get current schema version from database
 */
export function getSchemaVersion(db: Db): number {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const result = db.prepare("SELECT MAX(version) as version FROM schema_versions").get();
    return (result?.version as number) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Apply all pending migrations
 */
export function runMigrations(db: Database): void {
  const currentVersion = getSchemaVersion(db);
  const latestVersion = migrations.length;

  if (currentVersion >= latestVersion) {
    return;
  }

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      migration.up(db);
      db.prepare(`INSERT OR IGNORE INTO schema_versions (version) VALUES (?)`).run(migration.version);
    }
  }
}
