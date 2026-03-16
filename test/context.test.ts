import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { MessageStore } from '../src/engine/MessageStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { SummaryStore } from '../src/dag/SummaryStore.js';
import { ContextStore } from '../src/engine/ContextStore.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('ContextStore', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let msgStore: MessageStore;
  let sessionMgr: SessionManager;
  let summaryStore: SummaryStore;
  let ctxStore: ContextStore;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    msgStore = new MessageStore(db);
    sessionMgr = new SessionManager(db);
    summaryStore = new SummaryStore(db);
    ctxStore = new ContextStore(msgStore, sessionMgr, summaryStore, 3); // small fresh tail
    sessionId = sessionMgr.create().id;
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should return empty context for session with no messages', () => {
    const result = ctxStore.getContext(sessionId);
    
    expect(result.items).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('should get context from fresh tail', () => {
    msgStore.create(sessionId, 'user', 'Hello');
    msgStore.create(sessionId, 'assistant', 'Hi there');
    msgStore.create(sessionId, 'user', 'How are you?');
    msgStore.create(sessionId, 'user', 'Message 4'); // exceeds fresh tail
    msgStore.create(sessionId, 'user', 'Message 5'); // exceeds fresh tail
    
    const result = ctxStore.getContext(sessionId);
    
    // Should have 3 from fresh tail (configured as 3)
    expect(result.items.length).toBe(3);
    // All should be messages (not summaries)
    expect(result.items.every(i => i.type === 'message')).toBe(true);
  });

  it('should respect maxTokens limit', () => {
    // Create small messages
    msgStore.create(sessionId, 'user', 'A'); // 1 token
    msgStore.create(sessionId, 'user', 'B'); // 1 token  
    msgStore.create(sessionId, 'user', 'C'); // 1 token
    
    const result = ctxStore.getContext(sessionId, { maxTokens: 2 });
    
    // Should only fit 2 messages
    expect(result.totalTokens).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });

  it('should return truncated flag when over limit', () => {
    msgStore.create(sessionId, 'user', 'Short');
    msgStore.create(sessionId, 'user', 'Short');
    
    const result = ctxStore.getContext(sessionId, { maxTokens: 1 });
    
    expect(result.truncated).toBe(true);
  });

  it('should throw for non-existent session', () => {
    expect(() => ctxStore.getContext('nonexistent')).toThrow('Session not found');
  });

  it('should get token count', () => {
    msgStore.create(sessionId, 'user', 'Hello world'); // ~3 tokens
    msgStore.create(sessionId, 'assistant', 'Hi'); // ~1 token
    
    const count = ctxStore.getTokenCount(sessionId);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('should detect when compaction is needed', () => {
    // Add some messages but not enough to trigger
    for (let i = 0; i < 5; i++) {
      msgStore.create(sessionId, 'user', 'Message ' + i);
    }
    
    const needsCompaction = ctxStore.needsCompaction(sessionId, 0.75);
    expect(needsCompaction).toBe(false);
  });

  it('should not include summaries by default', () => {
    msgStore.create(sessionId, 'user', 'Hello');
    
    const result = ctxStore.getContext(sessionId, { includeSummaries: false });
    
    expect(result.items.every(i => i.type === 'message')).toBe(true);
  });

  it('should assemble context with summaries from DAG', () => {
    // Add some messages and create a summary
    const m1 = msgStore.create(sessionId, 'user', 'First message');
    const m2 = msgStore.create(sessionId, 'user', 'Second message');
    
    // Create a leaf summary
    summaryStore.create(sessionId, 0, 'Summary of the conversation', {
      sourceMessageIds: [m1.id, m2.id],
    });
    
    const result = ctxStore.getContext(sessionId);
    
    // Should have summary + fresh tail (which is empty since we compacted those messages)
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.some(i => i.type === 'summary')).toBe(true);
  });

  it('should get DAG depth', () => {
    summaryStore.create(sessionId, 0, 'Level 0');
    summaryStore.create(sessionId, 1, 'Level 1');
    summaryStore.create(sessionId, 2, 'Level 2');
    
    const depth = ctxStore.getDagDepth(sessionId);
    expect(depth).toBe(2);
  });

  it('should count total tokens including summaries', () => {
    msgStore.create(sessionId, 'user', 'Hello world'); // ~3 tokens
    summaryStore.create(sessionId, 0, 'A summary'); // ~2 tokens
    
    const count = ctxStore.getTokenCount(sessionId);
    expect(count).toBeGreaterThanOrEqual(5);
  });
});
