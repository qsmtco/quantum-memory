import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface QuantumConfig {
  databasePath: string;
}

const DEFAULT_CONFIG: QuantumConfig = {
  databasePath: '~/.openclaw/quantum.db',
};

function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export class QuantumDatabase {
  private db: Database.Database | null = null;
  private config: QuantumConfig;

  constructor(config: Partial<QuantumConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize database connection and create tables
   */
  initialize(): void {
    const dbPath = expandPath(this.config.databasePath);
    const dbDir = join(dbPath, '..');
    
    // Ensure directory exists
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open connection with WAL mode
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    // Create schema
    this.createTables();
    
    console.log(`[QuantumMemory] Database initialized at: ${dbPath}`);
  }

  /**
   * Get the database instance
   */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Create all tables
   */
  private createTables(): void {
    if (!this.db) return;

    // Projects table
    this.db.exec(`
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
    this.db.exec(`
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

    // Messages table (schema v1)
    this.db.exec(`
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

    // Summaries table (DAG nodes) (schema v1)
    this.db.exec(`
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

    // Entities table (schema v1)
    this.db.exec(`
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

    // Relations table (Knowledge Graph) (schema v1)
    this.db.exec(`
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

    // Memory inject table (auto-recall cache)
    this.db.exec(`
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

    // Drop log table (smart drop tracking)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drop_log (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        message_ids TEXT,
        reason TEXT,
        dropped_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Schema version tracking (for future migrations)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Large files table (for large file handling)
    this.db.exec(`
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS summary_cache (
        content_hash TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        token_count INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create indexes
    this.createIndexes();
  }

  /**
   * Create all indexes
   */
  private createIndexes(): void {
    if (!this.db) return;

    // Messages indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)
    `);

    // Summaries indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id, level)
    `);

    // Entities indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id, type)
    `);

    // Relations indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_relations_session ON relations(session_id, relation_type)
    `);

    // Memory inject indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inject_session ON memory_inject(session_id);
      CREATE INDEX IF NOT EXISTS idx_inject_at ON memory_inject(injected_at)
    `);

    // Drop log indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_drop_session ON drop_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_drop_at ON drop_log(dropped_at)
    `);

    // Large files indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_large_files_session ON large_files(session_id);
      CREATE INDEX IF NOT EXISTS idx_large_files_file_id ON large_files(file_id)
    `);

    // Summary cache indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_summary_cache_hash ON summary_cache(content_hash)
    `);

    // Summary cache indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_summary_cache_hash ON summary_cache(content_hash)
    `);

    // FTS5 virtual table for full-text search (mirrors migrations/index.ts)
    this.createFtsTable();
  }

  /**
   * Create FTS5 virtual table and triggers
   * Mirrors schema in migrations/index.ts
   * Note: FTS5 may not be available on all SQLite builds
   */
  private createFtsTable(): void {
    if (!this.db) return;
    
    try {
      // FTS5 virtual table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid'
        )
      `);

      // Insert trigger
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END
      `);

      // Delete trigger
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        END
      `);

      // Update trigger
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END
      `);
    } catch (ftsError) {
      console.warn('[QuantumMemory] FTS5 not available:', ftsError);
    }
  }

  /**
   * Check if FTS5 is available and the index is populated.
   * Returns { available: bool, rowCount: number, error?: string }
   */
  isFtsReady(): { available: boolean; rowCount: number; error?: string } {
    if (!this.db) return { available: false, rowCount: 0, error: 'Database not initialized' };
    try {
      const result = this.query<{c: number}>('SELECT COUNT(*) as c FROM messages_fts');
      const rowCount = result[0]?.c ?? 0;
      return { available: true, rowCount };
    } catch (e: any) {
      return { available: false, rowCount: 0, error: e.message };
    }
  }

  /**
   * Rebuild the FTS5 index from scratch.
   * Removes and recreates the FTS5 table and triggers,
   * then re-populates from all messages.
   * Use this if the index drifts or was created after messages were inserted.
   */
  rebuildFtsIndex(): { success: boolean; rowsIndexed: number; error?: string } {
    if (!this.db) return { success: false, rowsIndexed: 0, error: 'Database not initialized' };
    try {
      // Check FTS5 is available
      const ready = this.isFtsReady();
      if (!ready.available) {
        return { success: false, rowsIndexed: 0, error: ready.error };
      }

      // Detach and recreate FTS5 table (preserve messages data)
      this.db.exec(`DROP TABLE IF EXISTS messages_fts`);
      this.db.exec(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid'
        )
      `);

      // Drop old triggers
      this.db.exec(`DROP TRIGGER IF EXISTS messages_fts_insert`);
      this.db.exec(`DROP TRIGGER IF EXISTS messages_fts_delete`);
      this.db.exec(`DROP TRIGGER IF EXISTS messages_fts_update`);

      // Recreate triggers
      this.db.exec(`
        CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END
      `);

      // Populate FTS5 from existing messages
      this.db.exec(`
        INSERT INTO messages_fts(rowid, content)
        SELECT rowid, content FROM messages WHERE content IS NOT NULL
      `);

      const count = this.query<{c: number}>('SELECT COUNT(*) as c FROM messages_fts');
      const rowsIndexed = count[0]?.c ?? 0;
      console.log(`[QuantumMemory] FTS5 index rebuilt: ${rowsIndexed} rows indexed`);
      return { success: true, rowsIndexed };
    } catch (e: any) {
      return { success: false, rowsIndexed: 0, error: e.message };
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[QuantumMemory] Database connection closed');
    }
  }

  /**
   * Run a query and return results
   */
  query<T>(sql: string, params: unknown[] = []): T[] {
    const db = this.getDatabase();
    return db.prepare(sql).all(...params) as T[];
  }

  /**
   * Run a statement (insert/update/delete)
   */
  run(sql: string, params: unknown[] = []): Database.RunResult {
    const db = this.getDatabase();
    return db.prepare(sql).run(...params);
  }

  /**
   * Get a single row
   */
  get<T>(sql: string, params: unknown[] = []): T | undefined {
    const db = this.getDatabase();
    return db.prepare(sql).get(...params) as T | undefined;
  }
}

/**
 * Get database instance (singleton pattern for plugin lifecycle)
 */
let dbInstance: QuantumDatabase | null = null;

export function getDatabase(config?: Partial<QuantumConfig>): QuantumDatabase {
  if (!dbInstance) {
    dbInstance = new QuantumDatabase(config);
    dbInstance.initialize();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
