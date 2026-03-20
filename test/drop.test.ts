import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { SmartDropper } from '../src/drop/SmartDropper.js';
import { MessageStore } from '../src/engine/MessageStore.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('SmartDropper', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let dropper: SmartDropper;
  let msgStore: MessageStore;
  let sessionMgr: SessionManager;
  let sessionId: string;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    dropper = new SmartDropper(db);
    msgStore = new MessageStore(db);
    sessionMgr = new SessionManager(db);
    sessionId = sessionMgr.create().id;
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('should analyze messages for dropping', () => {
    const m1 = msgStore.create(sessionId, 'user', 'Important message');
    const m2 = msgStore.create(sessionId, 'user', 'Low value');
    const m3 = msgStore.create(sessionId, 'user', 'Another');
    
    msgStore.updateImportance(m1.id, 0.8);
    msgStore.updateImportance(m2.id, 0.1);
    msgStore.updateImportance(m3.id, 0.5);
    
    // analyze() is sync and checks importance_score directly
    const analysis = dropper.analyze(sessionId, 0.3);
    
    expect(analysis.length).toBe(1);
    expect(analysis[0].messageId).toBe(m2.id);
  });

  it('should drop low-value messages', async () => {
    const m1 = msgStore.create(sessionId, 'user', 'Drop me');
    const m2 = msgStore.create(sessionId, 'user', 'Keep me');
    
    msgStore.updateImportance(m1.id, 0.1);
    msgStore.updateImportance(m2.id, 0.8);
    
    const result = await dropper.drop(sessionId, 0.3);
    
    expect(result.dropped).toBe(1);
    
    const m1After = msgStore.get(m1.id);
    expect(m1After?.isCompacted).toBe(true);
  });

  it('should support dry run', async () => {
    const m1 = msgStore.create(sessionId, 'user', 'Drop me');
    msgStore.updateImportance(m1.id, 0.1);
    
    const result = await dropper.drop(sessionId, 0.3, true);
    
    expect(result.dropped).toBe(1);
    
    const m1After = msgStore.get(m1.id);
    expect(m1After?.isCompacted).toBe(false); // Not actually dropped
  });

  it('should get drop log', async () => {
    const m1 = msgStore.create(sessionId, 'user', 'Dropped');
    msgStore.updateImportance(m1.id, 0.1);
    
    await dropper.drop(sessionId, 0.3);
    
    const log = dropper.getDropLog(sessionId);
    
    expect(log.length).toBe(1);
    expect(log[0].messageIds).toContain(m1.id);
  });

  it('should return empty when no messages to drop', async () => {
    msgStore.create(sessionId, 'user', 'Important');
    msgStore.updateImportance(msgStore.getBySession(sessionId)[0].id, 0.9);
    
    const result = await dropper.drop(sessionId, 0.3);
    
    expect(result.dropped).toBe(0);
  });
});
