/**
 * Quantum Memory - Migration Runner
 * 
 * Simple migration system for schema upgrades.
 * 
 * Usage:
 *   import { runMigrations } from './migrations/index.js';
 *   runMigrations(db, currentVersion);
 * 
 * @see https://github.com/qsmtco/quantum-memory
 */

import type { Database } from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const migrations: Migration[] = [];

/**
 * Get current schema version from database
 */
export function getSchemaVersion(db: Database): number {
  try {
    const row = db.prepare("SELECT MAX(version) as version FROM schema_versions").get() as { version: number | null };
    return row?.version || 0;
  } catch {
    // Table doesn't exist yet
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
    console.log(`[QuantumMemory] Schema up-to-date at v${currentVersion}`);
    return;
  }
  
  console.log(`[QuantumMemory] Running migrations from v${currentVersion + 1} to v${latestVersion}`);
  
  for (let i = currentVersion; i < migrations.length; i++) {
    const migration = migrations[i];
    console.log(`[QuantumMemory] Applying migration v${migration.version}: ${migration.name}`);
    
    try {
      migration.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(migration.version);
      console.log(`[QuantumMemory] Migration v${migration.version} applied successfully`);
    } catch (error) {
      console.error(`[QuantumMemory] Migration v${migration.version} failed:`, error);
      throw error;
    }
  }
}

/**
 * Register a new migration
 */
export function registerMigration(version: number, name: string, up: (db: Database) => void): void {
  migrations[version - 1] = { version, name, up };
}
