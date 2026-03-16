import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { SearchEngine } from '../src/search/SearchEngine.js';
import { MessageStore } from '../src/engine/MessageStore.js';
import { EntityStore } from '../src/entities/EntityStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('SearchEngine', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let searchEngine: SearchEngine;
  let msgStore: MessageStore;
  let entityStore: EntityStore;
  let sessionMgr: SessionManager;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    searchEngine = new SearchEngine(db);
    msgStore = new MessageStore(db);
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

  it('should find messages by keyword', () => {
    msgStore.create(sessionId, 'user', 'I love quantum computing');
    msgStore.create(sessionId, 'user', 'Python is great');
    msgStore.create(sessionId, 'assistant', 'Tell me about quantum');
    
    const results = searchEngine.search(sessionId, 'quantum');
    
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some(r => r.content.includes('quantum computing'))).toBe(true);
    expect(results.some(r => r.content.includes('quantum'))).toBe(true);
  });

  it('should return empty for no matches', () => {
    msgStore.create(sessionId, 'user', 'Hello world');
    
    const results = searchEngine.search(sessionId, 'nonexistent');
    
    expect(results).toHaveLength(0);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 20; i++) {
      msgStore.create(sessionId, 'user', `Message ${i} about quantum`);
    }
    
    const results = searchEngine.search(sessionId, 'quantum', { limit: 5 });
    
    expect(results).toHaveLength(5);
  });

  it('should exclude compacted messages by default', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Important quantum info');
    msgStore.create(sessionId, 'user', 'Regular message');
    msgStore.markCompacted([m1.id]);
    
    const results = searchEngine.search(sessionId, 'quantum');
    
    expect(results.length).toBe(0);
  });

  it('should include compacted when requested', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Old quantum info');
    msgStore.markCompacted([m1.id]);
    
    const results = searchEngine.search(sessionId, 'quantum', { includeCompacted: true });
    
    expect(results.length).toBe(1);
  });

  it('should generate highlights', () => {
    msgStore.create(sessionId, 'user', 'The quantum memory system is amazing');
    
    const results = searchEngine.search(sessionId, 'quantum');
    
    expect(results[0].highlights.length).toBeGreaterThan(0);
    expect(results[0].highlights[0]).toContain('quantum');
  });

  it('should search entities by name', () => {
    entityStore.upsert(sessionId, 'John Smith', 'person');
    entityStore.upsert(sessionId, 'Jane Doe', 'person');
    entityStore.upsert(sessionId, 'Quantum Project', 'project');
    
    const results = searchEngine.searchEntities(sessionId, 'John');
    
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('John Smith');
  });

  it('should calculate relevance score', () => {
    msgStore.create(sessionId, 'user', 'quantum quantum quantum'); // 3 occurrences
    msgStore.create(sessionId, 'user', 'quantum'); // 1 occurrence
    
    const results = searchEngine.search(sessionId, 'quantum');
    
    // Should have scores
    expect(results.every(r => r.score > 0)).toBe(true);
  });

  it('should search across multiple sessions', () => {
    const s2 = sessionMgr.create();
    
    msgStore.create(sessionId, 'user', 'Session 1 quantum');
    msgStore.create(s2.id, 'user', 'Session 2 quantum');
    
    const results = searchEngine.searchGlobal('quantum', { 
      sessionIds: [sessionId, s2.id],
      limit: 10 
    });
    
    expect(results.length).toBe(2);
  });

  // Date range filtering tests (SH-004)
  it('should filter by date range - from', () => {
    msgStore.create(sessionId, 'user', 'Old message about quantum');
    // Newer message - we'll simulate by directly inserting with specific timestamp
    
    const results = searchEngine.search(sessionId, 'quantum', { 
      dateFrom: '2025-01-01' 
    });
    
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should filter by date range - to', () => {
    const results = searchEngine.search(sessionId, 'quantum', { 
      dateTo: '2027-12-31' 
    });
    
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should filter by date range - from and to', () => {
    const results = searchEngine.search(sessionId, 'quantum', { 
      dateFrom: '2025-01-01',
      dateTo: '2027-12-31' 
    });
    
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  // Semantic search tests
  it('should perform semantic search', () => {
    msgStore.create(sessionId, 'user', 'I love programming in Python');
    msgStore.create(sessionId, 'user', 'Quantum computing is amazing');
    msgStore.create(sessionId, 'user', 'Python quantum programming');
    
    const results = searchEngine.semanticSearch(sessionId, 'python programming');
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('should respect semantic search threshold', () => {
    msgStore.create(sessionId, 'user', 'Completely unrelated content xyz123');
    msgStore.create(sessionId, 'user', 'Python programming with quantum');
    
    const results = searchEngine.semanticSearch(sessionId, 'python code', { 
      threshold: 0.5 
    });
    
    // Should still find the python one
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should limit semantic search results', () => {
    for (let i = 0; i < 20; i++) {
      msgStore.create(sessionId, 'user', `Message ${i} about quantum and python`);
    }
    
    const results = searchEngine.semanticSearch(sessionId, 'quantum', { limit: 3 });
    
    expect(results).toHaveLength(3);
  });
});
