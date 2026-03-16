import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase, getDatabase, closeDatabase } from '../src/db/Database.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';

describe('QuantumDatabase', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  
  afterEach(() => {
    closeDatabase();
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should initialize database with all tables', () => {
    const db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    
    // Check tables exist
    const tables = db.getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    
    const tableNames = tables.map(t => t.name).sort();
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('summaries');
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('relations');
    expect(tableNames).toContain('memory_inject');
    expect(tableNames).toContain('drop_log');
    expect(tableNames).toContain('config');
  });

  it('should create indexes', () => {
    const db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    
    const indexes = db.getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('should use singleton pattern', () => {
    const db1 = getDatabase({ databasePath: testDbPath });
    const db2 = getDatabase({ databasePath: testDbPath });
    
    // Same instance
    expect(db1).toBe(db2);
  });
});
