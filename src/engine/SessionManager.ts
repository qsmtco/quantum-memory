import { randomUUID } from 'crypto';

export interface Session {
  id: string;
  projectId?: string;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'archived';
  metadata?: Record<string, unknown>;
}

/**
 * SessionManager - handles session lifecycle
 */
export class SessionManager {
  constructor(private db: any) {}

  /**
   * Create a new session
   */
  create(projectId?: string, metadata?: Record<string, unknown>): Session {
    const id = `sess_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    
    // If projectId is provided, ensure project exists
    if (projectId) {
      this.db.run(
        `INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)`,
        [projectId, projectId]
      );
    }
    
    this.db.run(
      `INSERT INTO sessions (id, project_id, started_at, status, metadata) VALUES (?, ?, ?, ?, ?)`,
      [id, projectId || null, now, 'active', metadata ? JSON.stringify(metadata) : null]
    );
    
    return {
      id,
      projectId,
      startedAt: now,
      status: 'active',
      metadata,
    };
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): Session | undefined {
    const row = this.db.get(
      `SELECT * FROM sessions WHERE id = ?`,
      [sessionId]
    );
    
    if (!row) return undefined;
    
    return this.mapRowToSession(row);
  }

  /**
   * Complete a session
   */
  complete(sessionId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.run(
      `UPDATE sessions SET status = 'completed', ended_at = ? WHERE id = ? AND status = 'active'`,
      [now, sessionId]
    );
    
    return result.changes > 0;
  }

  /**
   * Archive a session
   */
  archive(sessionId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.run(
      `UPDATE sessions SET status = 'archived', ended_at = ? WHERE id = ?`,
      [now, sessionId]
    );
    
    return result.changes > 0;
  }

  /**
   * List sessions with optional filters
   */
  list(options?: {
    projectId?: string;
    status?: 'active' | 'completed' | 'archived';
    limit?: number;
    offset?: number;
  }): Session[] {
    let sql = `SELECT * FROM sessions WHERE 1=1`;
    const params: any[] = [];
    
    if (options?.projectId) {
      sql += ` AND project_id = ?`;
      params.push(options.projectId);
    }
    
    if (options?.status) {
      sql += ` AND status = ?`;
      params.push(options.status);
    }
    
    sql += ` ORDER BY started_at DESC`;
    
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    
    if (options?.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }
    
    const rows = this.db.query(sql, params);
    return rows.map((row: any) => this.mapRowToSession(row));
  }

  /**
   * Get session count
   */
  count(filters?: {
    projectId?: string;
    status?: 'active' | 'completed' | 'archived';
  }): number {
    let sql = `SELECT COUNT(*) as count FROM sessions WHERE 1=1`;
    const params: any[] = [];
    
    if (filters?.projectId) {
      sql += ` AND project_id = ?`;
      params.push(filters.projectId);
    }
    
    if (filters?.status) {
      sql += ` AND status = ?`;
      params.push(filters.status);
    }
    
    const result = this.db.get(sql, params) as { count: number } | undefined;
    return result?.count ?? 0;
  }

  /**
   * Map database row to Session object
   */
  private mapRowToSession(row: any): Session {
    return {
      id: row.id,
      projectId: row.project_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
