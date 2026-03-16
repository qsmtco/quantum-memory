import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { MessageStore } from '../src/engine/MessageStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('MessageStore', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let msgStore: MessageStore;
  let sessionMgr: SessionManager;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    msgStore = new MessageStore(db);
    sessionMgr = new SessionManager(db);
    sessionId = sessionMgr.create().id;
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should create a message', () => {
    const msg = msgStore.create(sessionId, 'user', 'Hello world');
    
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.sessionId).toBe(sessionId);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello world');
    expect(msg.tokens).toBeGreaterThan(0);
    expect(msg.isCompacted).toBe(false);
  });

  it('should create multiple messages in batch', () => {
    const messages = [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'Second message' },
      { role: 'user', content: 'Third message' },
    ];
    
    const created = msgStore.createBatch(sessionId, messages);
    
    expect(created).toHaveLength(3);
    expect(created[0].role).toBe('user');
    expect(created[1].role).toBe('assistant');
  });

  it('should get message by ID', () => {
    const created = msgStore.create(sessionId, 'user', 'Test message');
    const retrieved = msgStore.get(created.id);
    
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.content).toBe('Test message');
  });

  it('should get messages by session', () => {
    msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'assistant', 'Message 2');
    msgStore.create(sessionId, 'user', 'Message 3');
    
    const messages = msgStore.getBySession(sessionId);
    
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('Message 1');
  });

  it('should respect limit and offset', () => {
    msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'user', 'Message 2');
    msgStore.create(sessionId, 'user', 'Message 3');
    
    const messages = msgStore.getBySession(sessionId, { limit: 2, offset: 1 });
    
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Message 2');
  });

  it('should count messages', () => {
    msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'user', 'Message 2');
    
    const count = msgStore.count(sessionId);
    expect(count).toBe(2);
  });

  it('should get total tokens', () => {
    msgStore.create(sessionId, 'user', 'Hello world'); // ~3 tokens
    msgStore.create(sessionId, 'assistant', 'Hi there!'); // ~2 tokens
    
    const total = msgStore.getTotalTokens(sessionId);
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it('should get fresh tail', () => {
    // Create messages - they may have same timestamp but unique IDs
    msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'user', 'Message 2');
    msgStore.create(sessionId, 'user', 'Message 3');
    msgStore.create(sessionId, 'user', 'Message 4');
    msgStore.create(sessionId, 'user', 'Message 5');
    
    // Get fresh tail of 3
    const tail = msgStore.getFreshTail(sessionId, 3);
    
    // Should return exactly 3 messages
    expect(tail).toHaveLength(3);
    
    // All should be uncompacted
    tail.forEach(msg => {
      expect(msg.isCompacted).toBe(false);
    });
  });

  it('should mark messages as compacted', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Old message');
    const m2 = msgStore.create(sessionId, 'user', 'New message');
    
    const count = msgStore.markCompacted([m1.id]);
    
    expect(count).toBe(1);
    
    const msg1 = msgStore.get(m1.id);
    const msg2 = msgStore.get(m2.id);
    
    expect(msg1?.isCompacted).toBe(true);
    expect(msg2?.isCompacted).toBe(false);
  });

  it('should update importance score', () => {
    const msg = msgStore.create(sessionId, 'user', 'Important message');
    
    const updated = msgStore.updateImportance(msg.id, 0.9);
    
    expect(updated).toBe(true);
    
    const retrieved = msgStore.get(msg.id);
    expect(retrieved?.importanceScore).toBe(0.9);
  });

  it('should get messages by importance threshold', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Low importance');
    const m2 = msgStore.create(sessionId, 'user', 'High importance');
    
    msgStore.updateImportance(m1.id, 0.2);
    msgStore.updateImportance(m2.id, 0.8);
    
    const lowImportance = msgStore.getByImportance(sessionId, 0.5);
    
    expect(lowImportance).toHaveLength(1);
    expect(lowImportance[0].id).toBe(m1.id);
  });

  it('should exclude compacted messages by default', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'user', 'Message 2');
    msgStore.markCompacted([m1.id]);
    
    const messages = msgStore.getBySession(sessionId);
    
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Message 2');
  });

  it('should include compacted messages when requested', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Message 1');
    msgStore.create(sessionId, 'user', 'Message 2');
    msgStore.markCompacted([m1.id]);
    
    const messages = msgStore.getBySession(sessionId, { includeCompacted: true });
    
    expect(messages).toHaveLength(2);
  });
});
