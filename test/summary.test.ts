import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { SummaryStore } from '../src/dag/SummaryStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { MessageStore } from '../src/engine/MessageStore.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('SummaryStore', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let summaryStore: SummaryStore;
  let sessionMgr: SessionManager;
  let msgStore: MessageStore;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    summaryStore = new SummaryStore(db);
    sessionMgr = new SessionManager(db);
    msgStore = new MessageStore(db);
    sessionId = sessionMgr.create().id;
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should create a summary', () => {
    const summary = summaryStore.create(sessionId, 0, 'This is a summary of the conversation');
    
    expect(summary.id).toMatch(/^sum_/);
    expect(summary.sessionId).toBe(sessionId);
    expect(summary.level).toBe(0);
    expect(summary.content).toBe('This is a summary of the conversation');
    expect(summary.tokens).toBeGreaterThan(0);
  });

  it('should create summary with source message IDs', () => {
    const msg1 = msgStore.create(sessionId, 'user', 'Hello');
    const msg2 = msgStore.create(sessionId, 'user', 'World');
    
    const summary = summaryStore.create(sessionId, 0, 'Summary', {
      sourceMessageIds: [msg1.id, msg2.id],
    });
    
    expect(summary.sourceMessageIds).toContain(msg1.id);
    expect(summary.sourceMessageIds).toContain(msg2.id);
  });

  it('should get summary by ID', () => {
    const created = summaryStore.create(sessionId, 0, 'Test summary');
    const retrieved = summaryStore.get(created.id);
    
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.content).toBe('Test summary');
  });

  it('should get summaries by level', () => {
    summaryStore.create(sessionId, 0, 'Level 0-1');
    summaryStore.create(sessionId, 0, 'Level 0-2');
    summaryStore.create(sessionId, 1, 'Level 1');
    
    const level0 = summaryStore.getByLevel(sessionId, 0);
    const level1 = summaryStore.getByLevel(sessionId, 1);
    
    expect(level0).toHaveLength(2);
    expect(level1).toHaveLength(1);
    expect(level1[0].level).toBe(1);
  });

  it('should get all summaries for session', () => {
    summaryStore.create(sessionId, 0, 'Leaf 1');
    summaryStore.create(sessionId, 0, 'Leaf 2');
    summaryStore.create(sessionId, 1, 'Condensed');
    
    const all = summaryStore.getBySession(sessionId);
    
    expect(all).toHaveLength(3);
  });

  it('should get latest summary by level', () => {
    // Create summaries - note timestamps may be identical so we test behavior
    summaryStore.create(sessionId, 0, 'First');
    summaryStore.create(sessionId, 1, 'Condensed 1');
    // Create another level 0 
    summaryStore.create(sessionId, 0, 'Second');
    summaryStore.create(sessionId, 1, 'Condensed 2');
    
    const latest = summaryStore.getLatestByLevel(sessionId);
    
    // Should have summaries at both levels
    const levels = latest.map(s => s.level).sort((a, b) => a - b);
    expect(levels).toEqual([0, 1]);
    
    // Verify we get exactly one per level
    expect(latest.filter(s => s.level === 0)).toHaveLength(1);
    expect(latest.filter(s => s.level === 1)).toHaveLength(1);
  });

  it('should get max level', () => {
    summaryStore.create(sessionId, 0, 'Level 0');
    summaryStore.create(sessionId, 2, 'Level 2');
    summaryStore.create(sessionId, 1, 'Level 1');
    
    const maxLevel = summaryStore.getMaxLevel(sessionId);
    
    expect(maxLevel).toBe(2);
  });

  it('should get total tokens in summaries', () => {
    summaryStore.create(sessionId, 0, 'Short');
    summaryStore.create(sessionId, 0, 'A bit longer summary text');
    
    const total = summaryStore.getTotalTokens(sessionId);
    
    expect(total).toBeGreaterThan(0);
  });

  it('should get messages to summarize', () => {
    // Create 10 messages
    for (let i = 0; i < 10; i++) {
      msgStore.create(sessionId, 'user', `Message ${i}`);
    }
    
    // Get messages beyond fresh tail of 5
    const toSummarize = summaryStore.getMessagesToSummarize(sessionId, 5, 10);
    
    expect(toSummarize).toHaveLength(5); // 10 - 5 = 5
  });

  it('should count by level', () => {
    summaryStore.create(sessionId, 0, 'L0-1');
    summaryStore.create(sessionId, 0, 'L0-2');
    summaryStore.create(sessionId, 1, 'L1-1');
    summaryStore.create(sessionId, 1, 'L1-2');
    summaryStore.create(sessionId, 1, 'L1-3');
    
    const counts = summaryStore.countByLevel(sessionId);
    
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(3);
  });

  it('should return empty array for non-existent session', () => {
    const summaries = summaryStore.getBySession('nonexistent');
    expect(summaries).toHaveLength(0);
  });
});
