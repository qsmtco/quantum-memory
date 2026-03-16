import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { EntityStore } from '../src/entities/EntityStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('EntityStore', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let entityStore: EntityStore;
  let sessionMgr: SessionManager;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    entityStore = new EntityStore(db);
    sessionMgr = new SessionManager(db);
    sessionId = sessionMgr.create().id;
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should create an entity', () => {
    const entity = entityStore.upsert(sessionId, 'John', 'person');
    
    expect(entity.id).toMatch(/^ent_/);
    expect(entity.name).toBe('John');
    expect(entity.type).toBe('person');
    expect(entity.mentionCount).toBe(1);
  });

  it('should upsert (update existing)', () => {
    entityStore.upsert(sessionId, 'John', 'person');
    const updated = entityStore.upsert(sessionId, 'John', 'person');
    
    expect(updated.mentionCount).toBe(2);
  });

  it('should get entity by ID', () => {
    const created = entityStore.upsert(sessionId, 'ProjectX', 'project');
    const retrieved = entityStore.get(created.id);
    
    expect(retrieved?.name).toBe('ProjectX');
  });

  it('should find by name and type', () => {
    entityStore.upsert(sessionId, 'Alice', 'person');
    
    const found = entityStore.findByName(sessionId, 'Alice', 'person');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Alice');
  });

  it('should get entities by session', () => {
    entityStore.upsert(sessionId, 'John', 'person');
    entityStore.upsert(sessionId, 'ProjectX', 'project');
    entityStore.upsert(sessionId, 'GPT-4', 'tool');
    
    const entities = entityStore.getBySession(sessionId);
    expect(entities).toHaveLength(3);
  });

  it('should filter by type', () => {
    entityStore.upsert(sessionId, 'John', 'person');
    entityStore.upsert(sessionId, 'Jane', 'person');
    entityStore.upsert(sessionId, 'ProjectX', 'project');
    
    const persons = entityStore.getByType(sessionId, 'person');
    expect(persons).toHaveLength(2);
  });

  it('should count by type', () => {
    entityStore.upsert(sessionId, 'John', 'person');
    entityStore.upsert(sessionId, 'Jane', 'person');
    entityStore.upsert(sessionId, 'ProjectX', 'project');
    
    const counts = entityStore.countByType(sessionId);
    expect(counts.person).toBe(2);
    expect(counts.project).toBe(1);
  });

  it('should search by pattern', () => {
    entityStore.upsert(sessionId, 'Quantum Memory', 'project');
    entityStore.upsert(sessionId, 'Quantum Engine', 'concept');
    entityStore.upsert(sessionId, 'GPT-4', 'tool');
    
    const results = entityStore.search(sessionId, 'Quantum');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('should filter by min mentions', () => {
    entityStore.upsert(sessionId, 'John', 'person');
    entityStore.upsert(sessionId, 'John', 'person');
    entityStore.upsert(sessionId, 'Jane', 'person');
    
    const entities = entityStore.getBySession(sessionId, { minMentions: 2 });
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('John');
  });

  it('should delete entity', () => {
    const entity = entityStore.upsert(sessionId, 'ToDelete', 'person');
    
    const deleted = entityStore.delete(entity.id);
    expect(deleted).toBe(true);
    
    const retrieved = entityStore.get(entity.id);
    expect(retrieved).toBeUndefined();
  });
});
