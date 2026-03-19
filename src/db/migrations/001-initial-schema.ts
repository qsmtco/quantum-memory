/**
 * Quantum Memory - Initial Schema Migration (v1)
 * 
 * This is the initial schema - all tables are created here.
 * Future migrations should add new tables/columns here.
 * 
 * @see https://github.com/qsmtco/quantum-memory
 */

import type { Database } from "better-sqlite3";

/**
 * Run initial schema migration (v1)
 * Creates all tables if they don't exist
 */
export function runQuantumMigrations(db: Database): void {
  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      token_count INTEGER,
      is_compacted INTEGER NOT NULL DEFAULT 0,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT,
      UNIQUE (session_id, name, type)
    )
  `);

  // Relations table (knowledge graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      from_entity TEXT NOT NULL,
      to_entity TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, from_entity, to_entity, relation_type)
    )
  `);

  // Memory inject cache (auto-recall)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_inject (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_ids TEXT,
      query TEXT,
      injected_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Drop log (smart dropping history)
  db.exec(`
    CREATE TABLE IF NOT EXISTS drop_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_ids TEXT NOT NULL,
      reason TEXT NOT NULL,
      dropped_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  // Schema version tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id, level);
    CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id, type);
    CREATE INDEX IF NOT EXISTS idx_relations_session ON relations(session_id, relation_type);
  `);

  // Record that v1 has been applied
  db.exec(`INSERT OR IGNORE INTO schema_versions (version) VALUES (1)`);
}
