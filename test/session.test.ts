import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('SessionManager', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let sessionMgr: SessionManager;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    sessionMgr = new SessionManager(db);
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should create a session', () => {
    const session = sessionMgr.create();
    
    expect(session.id).toMatch(/^sess_/);
    expect(session.status).toBe('active');
    expect(session.startedAt).toBeDefined();
  });

  it('should get a session by ID', () => {
    const created = sessionMgr.create();
    const retrieved = sessionMgr.get(created.id);
    
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.status).toBe('active');
  });

  it('should return undefined for non-existent session', () => {
    const result = sessionMgr.get('sess_nonexistent');
    expect(result).toBeUndefined();
  });

  it('should complete a session', () => {
    const session = sessionMgr.create();
    const result = sessionMgr.complete(session.id);
    
    expect(result).toBe(true);
    
    const updated = sessionMgr.get(session.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.endedAt).toBeDefined();
  });

  it('should not complete already completed session', () => {
    const session = sessionMgr.create();
    sessionMgr.complete(session.id);
    
    const result = sessionMgr.complete(session.id);
    expect(result).toBe(false);
  });

  it('should archive a session', () => {
    const session = sessionMgr.create();
    const result = sessionMgr.archive(session.id);
    
    expect(result).toBe(true);
    
    const updated = sessionMgr.get(session.id);
    expect(updated?.status).toBe('archived');
  });

  it('should list sessions', () => {
    sessionMgr.create();
    sessionMgr.create();
    sessionMgr.create();
    
    const sessions = sessionMgr.list();
    expect(sessions.length).toBe(3);
  });

  it('should filter sessions by status', () => {
    const s1 = sessionMgr.create();
    const s2 = sessionMgr.create();
    sessionMgr.complete(s1.id);
    
    const active = sessionMgr.list({ status: 'active' });
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(s2.id);
  });

  it('should count sessions', () => {
    sessionMgr.create();
    sessionMgr.create();
    sessionMgr.create();
    
    const count = sessionMgr.count();
    expect(count).toBe(3);
  });

  it('should create session with project ID', () => {
    const session = sessionMgr.create('project-alpha');
    expect(session.projectId).toBe('project-alpha');
  });
});
