import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumDatabase } from '../src/db/Database.js';
import { ProjectManager } from '../src/projects/ProjectManager.js';
import { SessionManager } from '../src/engine/SessionManager.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

describe('ProjectManager', () => {
  const testDbPath = `/tmp/quantum-test-${randomUUID().slice(0, 8)}.db`;
  let db: QuantumDatabase;
  let projMgr: ProjectManager;
  let sessionMgr: SessionManager;
  
  beforeEach(() => {
    db = new QuantumDatabase({ databasePath: testDbPath });
    db.initialize();
    projMgr = new ProjectManager(db);
    sessionMgr = new SessionManager(db);
  });
  
  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('should create a project', () => {
    const proj = projMgr.create('My Project');
    
    expect(proj.id).toMatch(/^proj_/);
    expect(proj.name).toBe('My Project');
    expect(proj.createdAt).toBeDefined();
  });

  it('should get project by ID', () => {
    const created = projMgr.create('Test Project');
    const retrieved = projMgr.get(created.id);
    
    expect(retrieved?.name).toBe('Test Project');
  });

  it('should get project by name', () => {
    projMgr.create('Unique Project Name');
    const retrieved = projMgr.getByName('Unique Project Name');
    
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Unique Project Name');
  });

  it('should list all projects', () => {
    projMgr.create('Project A');
    projMgr.create('Project B');
    projMgr.create('Project C');
    
    const list = projMgr.list();
    
    expect(list.length).toBeGreaterThanOrEqual(3);
  });

  it('should touch project (update last accessed)', () => {
    const proj = projMgr.create('Touch Test');
    const before = proj.lastAccessed;
    
    projMgr.touch(proj.id);
    const after = projMgr.get(proj.id);
    
    expect(after?.lastAccessed).toBeDefined();
  });

  it('should delete project', () => {
    const proj = projMgr.create('To Delete');
    
    const deleted = projMgr.delete(proj.id);
    expect(deleted).toBe(true);
    
    const retrieved = projMgr.get(proj.id);
    expect(retrieved).toBeUndefined();
  });

  it('should get session count', () => {
    const proj = projMgr.create('Sessions Test');
    sessionMgr.create(proj.id);
    sessionMgr.create(proj.id);
    sessionMgr.create(proj.id);
    
    const count = projMgr.getSessionCount(proj.id);
    expect(count).toBe(3);
  });
});
