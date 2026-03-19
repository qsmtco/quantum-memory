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
        created_at TEXT DEFAULT (datetime('now')),
        last_accessed TEXT
      )
    `);

    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        status TEXT DEFAULT 'active',
        metadata TEXT
      )
    `);

    // Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        importance_score REAL DEFAULT 0.5,
        is_compacted INTEGER DEFAULT 0
      )
    `);

    // Summaries table (DAG)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        parent_id TEXT REFERENCES summaries(id),
        level INTEGER NOT NULL,
        content TEXT NOT NULL,
        source_message_ids TEXT,
        source_summary_ids TEXT,
        tokens INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        model_used TEXT
      )
    `);

    // Entities table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT,
        mention_count INTEGER DEFAULT 1,
        metadata TEXT
      )
    `);

    // Relations table (Knowledge Graph)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        from_entity_id TEXT REFERENCES entities(id),
        to_entity_id TEXT REFERENCES entities(id),
        relationship TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        source_message_id TEXT REFERENCES messages(id),
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Memory inject table (auto-recall cache)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_inject (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        content TEXT NOT NULL,
        source_ids TEXT,
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
        value TEXT NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)
    `);

    // Summaries indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_level ON summaries(level);
      CREATE INDEX IF NOT EXISTS idx_summaries_parent ON summaries(parent_id)
    `);

    // Entities indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)
    `);

    // Relations indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relationship)
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
