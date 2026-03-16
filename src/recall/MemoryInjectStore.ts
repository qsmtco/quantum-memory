export interface MemoryInject {
  id: string;
  sessionId: string;
  content: string;
  sourceIds: string[];
  injectedAt: string;
  wasUseful?: boolean;
}

export interface AutoRecallOptions {
  maxTokens?: number;
  query?: string;
}

/**
 * MemoryInjectStore - stores injected memories for feedback tracking
 */
export class MemoryInjectStore {
  constructor(private db: any) {}

  /**
   * Record a memory injection
   */
  record(sessionId: string, content: string, sourceIds: string[] = []): MemoryInject {
    const id = `inj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    
    this.db.run(
      `INSERT INTO memory_inject (id, session_id, content, source_ids, injected_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, sessionId, content, JSON.stringify(sourceIds), now]
    );
    
    return {
      id,
      sessionId,
      content,
      sourceIds,
      injectedAt: now,
    };
  }

  /**
   * Mark injection as useful
   */
  markUseful(injectId: string, useful: boolean): boolean {
    const result = this.db.run(
      `UPDATE memory_inject SET was_useful = ? WHERE id = ?`,
      [useful ? 1 : 0, injectId]
    );
    return result.changes > 0;
  }

  /**
   * Get injection history
   */
  getHistory(sessionId: string, limit: number = 10): MemoryInject[] {
    const rows = this.db.query(
      `SELECT * FROM memory_inject WHERE session_id = ? ORDER BY injected_at DESC LIMIT ?`,
      [sessionId, limit]
    );
    
    return rows.map((row: any) => this.mapRowToInject(row));
  }

  /**
   * Get usefulness stats
   */
  getStats(sessionId: string): { total: number; useful: number; rate: number } {
    const total = this.db.get(
      `SELECT COUNT(*) as count FROM memory_inject WHERE session_id = ?`,
      [sessionId]
    ) as { count: number };
    
    const useful = this.db.get(
      `SELECT COUNT(*) as count FROM memory_inject WHERE session_id = ? AND was_useful = 1`,
      [sessionId]
    ) as { count: number };
    
    const rate = total.count > 0 ? useful.count / total.count : 0;
    
    return {
      total: total.count,
      useful: useful.count,
      rate,
    };
  }

  private mapRowToInject(row: any): MemoryInject {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      sourceIds: JSON.parse(row.source_ids || '[]'),
      injectedAt: row.injected_at,
      wasUseful: row.was_useful === 1 ? true : row.was_useful === 0 ? false : undefined,
    };
  }
}
