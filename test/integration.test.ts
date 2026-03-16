import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { MessageStore } from '../src/engine/MessageStore.js';
import { ContextStore } from '../src/engine/ContextStore.js';
import { SummaryStore } from '../src/dag/SummaryStore.js';
import { EntityStore } from '../src/entities/EntityStore.js';
import { RelationStore } from '../src/entities/RelationStore.js';
import { SearchEngine } from '../src/search/SearchEngine.js';
import { ProjectManager } from '../src/projects/ProjectManager.js';
import { MemoryInjectStore } from '../src/recall/MemoryInjectStore.js';
import { AutoRecallInjector } from '../src/recall/AutoRecallInjector.js';
import { SmartDropper } from '../src/drop/SmartDropper.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('Quantum Memory - Full Integration', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let sessionMgr: SessionManager;
  let msgStore: MessageStore;
  let ctxStore: ContextStore;
  let summaryStore: SummaryStore;
  let entityStore: EntityStore;
  let relationStore: RelationStore;
  let searchEngine: SearchEngine;
  let projMgr: ProjectManager;
  let injector: AutoRecallInjector;
  let dropper: SmartDropper;
  let injectStore: MemoryInjectStore;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    
    // Initialize all components
    sessionMgr = new SessionManager(db);
    msgStore = new MessageStore(db);
    summaryStore = new SummaryStore(db);
    entityStore = new EntityStore(db);
    relationStore = new RelationStore(db);
    searchEngine = new SearchEngine(db);
    projMgr = new ProjectManager(db);
    injectStore = new MemoryInjectStore(db);
    injector = new AutoRecallInjector(searchEngine, entityStore, injectStore);
    dropper = new SmartDropper(db);
    ctxStore = new ContextStore(msgStore, sessionMgr, summaryStore, 32);
    
    // Create project and session
    const proj = projMgr.create('Integration Test Project');
    sessionId = sessionMgr.create(proj.id).id;
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('should complete full workflow: create session, add messages, extract entities, search, recall', () => {
    // 1. Create messages
    const m1 = msgStore.create(sessionId, 'user', 'I am working with John on the Quantum project');
    const m2 = msgStore.create(sessionId, 'assistant', 'That sounds interesting!');
    const m3 = msgStore.create(sessionId, 'user', 'John uses Python and TensorFlow for machine learning');
    
    // 2. Extract entities
    const john = entityStore.upsert(sessionId, 'John', 'person');
    const quantum = entityStore.upsert(sessionId, 'Quantum', 'project');
    const python = entityStore.upsert(sessionId, 'Python', 'tool');
    
    expect(john.mentionCount).toBe(1);
    expect(quantum.mentionCount).toBe(1);
    
    // 3. Create relations
    relationStore.create(sessionId, john.id, quantum.id, 'works_on');
    relationStore.create(sessionId, john.id, python.id, 'uses');
    
    // 4. Search works
    const searchResults = searchEngine.search(sessionId, 'Quantum');
    expect(searchResults.length).toBeGreaterThan(0);
    
    // 5. Entity search works
    const entityResults = searchEngine.searchEntities(sessionId, 'John');
    expect(entityResults.length).toBe(1);
    expect(entityResults[0].name).toBe('John');
    
    // 6. Context retrieval works
    const context = ctxStore.getContext(sessionId);
    expect(context.items.length).toBeGreaterThan(0);
    
    // 7. Create summary
    summaryStore.create(sessionId, 0, 'Summary of conversation', {
      sourceMessageIds: [m1.id, m2.id, m3.id],
    });
    
    // 8. Get updated context with summary
    const contextWithSummary = ctxStore.getContext(sessionId);
    expect(contextWithSummary.items.some(i => i.type === 'summary')).toBe(true);
    
    // 9. DAG depth
    const dagDepth = ctxStore.getDagDepth(sessionId);
    expect(dagDepth).toBe(0); // Level 0
    
    // 10. Token count
    const tokens = ctxStore.getTokenCount(sessionId);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle project-scoped sessions', () => {
    // Create entities in first session
    entityStore.upsert(sessionId, 'Alice', 'person');
    
    // Create second session in different project
    const proj2 = projMgr.create('Second Project');
    const session2 = sessionMgr.create(proj2.id);
    
    // Add entity to second session
    entityStore.upsert(session2.id, 'Bob', 'person');
    
    // Verify isolation
    const entities = entityStore.getBySession(sessionId);
    const entities2 = entityStore.getBySession(session2.id);
    
    expect(entities.length).toBe(1);
    expect(entities2.length).toBe(1);
    expect(entities[0].name).toBe('Alice');
    expect(entities2[0].name).toBe('Bob');
  });

  it('should handle search with date filters', () => {
    msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'user', 'Message 2');
    
    // Search with date range
    const results = searchEngine.search(sessionId, 'Message', {
      dateFrom: '2020-01-01',
      dateTo: '2030-12-31',
    });
    
    expect(results.length).toBe(2);
  });

  it('should handle smart dropping', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Important content');
    const m2 = msgStore.create(sessionId, 'user', 'Less important');
    const m3 = msgStore.create(sessionId, 'user', 'Also important');
    
    // Set importance
    msgStore.updateImportance(m1.id, 0.9);
    msgStore.updateImportance(m2.id, 0.2); // Below threshold
    msgStore.updateImportance(m3.id, 0.8);
    
    // Drop low importance
    const dropResult = dropper.drop(sessionId, 0.3);
    
    expect(dropResult.dropped).toBe(1);
    
    // Verify drop log
    const dropLog = dropper.getDropLog(sessionId);
    expect(dropLog.length).toBe(1);
  });

  it('should handle empty session gracefully', () => {
    // New session has no messages
    const context = ctxStore.getContext(sessionId);
    expect(context.items.length).toBe(0);
    expect(context.totalTokens).toBe(0);
    expect(context.truncated).toBe(false);
    
    // Search returns empty
    const results = searchEngine.search(sessionId, 'anything');
    expect(results.length).toBe(0);
    
    // Entity list empty
    const entities = entityStore.getBySession(sessionId);
    expect(entities.length).toBe(0);
  });

  it('should verify entity counts by type', () => {
    entityStore.upsert(sessionId, 'John', 'person');
    entityStore.upsert(sessionId, 'Jane', 'person');
    entityStore.upsert(sessionId, 'ProjectA', 'project');
    entityStore.upsert(sessionId, 'ProjectB', 'project');
    entityStore.upsert(sessionId, 'GitHub', 'tool');
    
    const counts = entityStore.countByType(sessionId);
    
    expect(counts.person).toBe(2);
    expect(counts.project).toBe(2);
    expect(counts.tool).toBe(1);
  });

  it('should verify relation counts by type', () => {
    const john = entityStore.upsert(sessionId, 'John', 'person');
    const jane = entityStore.upsert(sessionId, 'Jane', 'person');
    const proj = entityStore.upsert(sessionId, 'Project', 'project');
    
    relationStore.create(sessionId, john.id, jane.id, 'knows');
    relationStore.create(sessionId, john.id, proj.id, 'works_on');
    relationStore.create(sessionId, jane.id, proj.id, 'works_on');
    
    const counts = relationStore.countByType(sessionId);
    
    expect(counts.knows).toBe(1);
    expect(counts.works_on).toBe(2);
  });
});
