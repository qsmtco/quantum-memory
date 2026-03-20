import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { RelationStore } from '../src/entities/RelationStore.js';
import { EntityStore } from '../src/entities/EntityStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('RelationStore', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let relationStore: RelationStore;
  let entityStore: EntityStore;
  let sessionMgr: SessionManager;
  let sessionId: string;
  let e1: any, e2: any, e3: any;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    relationStore = new RelationStore(db);
    entityStore = new EntityStore(db);
    sessionMgr = new SessionManager(db);
    sessionId = sessionMgr.create().id;
    
    // Create test entities
    e1 = entityStore.upsert(sessionId, 'Alice', 'person');
    e2 = entityStore.upsert(sessionId, 'Bob', 'person');
    e3 = entityStore.upsert(sessionId, 'ProjectX', 'project');
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should create a relation', () => {
    const relation = relationStore.create(sessionId, e1.id, e2.id, 'knows');
    
    expect(relation.id).toMatch(/^rel_/);
    expect(relation.fromEntityId).toBe(e1.id);
    expect(relation.toEntityId).toBe(e2.id);
    expect(relation.relation_type).toBe('knows');
    expect(relation.confidence).toBe(1.0);
  });

  it('should get relation by ID', () => {
    const created = relationStore.create(sessionId, e1.id, e2.id, 'knows');
    const retrieved = relationStore.get(created.id);
    
    expect(retrieved?.relation_type).toBe('knows');
  });

  it('should get relations by entity', () => {
    relationStore.create(sessionId, e1.id, e2.id, 'knows');
    relationStore.create(sessionId, e3.id, e1.id, 'owns');
    
    const relations = relationStore.getByEntity(e1.id);
    
    expect(relations.length).toBeGreaterThanOrEqual(2);
  });

  it('should get outgoing relations', () => {
    relationStore.create(sessionId, e1.id, e2.id, 'knows');
    relationStore.create(sessionId, e1.id, e3.id, 'works_on');
    
    const outgoing = relationStore.getOutgoing(e1.id);
    
    expect(outgoing).toHaveLength(2);
    expect(outgoing.every(r => r.fromEntityId === e1.id)).toBe(true);
  });

  it('should get incoming relations', () => {
    relationStore.create(sessionId, e2.id, e1.id, 'knows');
    
    const incoming = relationStore.getIncoming(e1.id);
    
    expect(incoming).toHaveLength(1);
    expect(incoming[0].toEntityId).toBe(e1.id);
  });

  it('should get relations by type', () => {
    relationStore.create(sessionId, e1.id, e2.id, 'knows');
    relationStore.create(sessionId, e2.id, e3.id, 'knows');
    relationStore.create(sessionId, e1.id, e3.id, 'works_on');
    
    const knowsRelations = relationStore.getByType(sessionId, 'knows');
    
    expect(knowsRelations).toHaveLength(2);
  });

  it('should check if relation exists', () => {
    relationStore.create(sessionId, e1.id, e2.id, 'knows');
    
    const exists = relationStore.exists(e1.id, e2.id, 'knows');
    const notExists = relationStore.exists(e1.id, e3.id, 'knows');
    
    expect(exists).toBe(true);
    expect(notExists).toBe(false);
  });

  it('should update confidence', () => {
    const rel = relationStore.create(sessionId, e1.id, e2.id, 'knows', { confidence: 0.5 });
    
    relationStore.updateConfidence(rel.id, 0.8);
    
    const updated = relationStore.get(rel.id);
    expect(updated?.confidence).toBe(0.8);
  });

  it('should delete relation', () => {
    const rel = relationStore.create(sessionId, e1.id, e2.id, 'knows');
    
    const deleted = relationStore.delete(rel.id);
    expect(deleted).toBe(true);
    
    const retrieved = relationStore.get(rel.id);
    expect(retrieved).toBeUndefined();
  });

  it('should count by type', () => {
    relationStore.create(sessionId, e1.id, e2.id, 'knows');
    relationStore.create(sessionId, e2.id, e3.id, 'knows');
    relationStore.create(sessionId, e1.id, e3.id, 'works_on');
    
    const counts = relationStore.countByType(sessionId);
    
    expect(counts.knows).toBe(2);
    expect(counts.works_on).toBe(1);
  });
});
