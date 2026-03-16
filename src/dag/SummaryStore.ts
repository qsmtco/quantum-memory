import { randomUUID } from 'crypto';

export interface Summary {
  id: string;
  sessionId: string;
  parentId?: string;
  level: number;
  content: string;
  sourceMessageIds: string[];
  sourceSummaryIds: string[];
  tokens: number;
  createdAt: string;
  modelUsed?: string;
}

/**
 * SummaryStore - manages DAG summaries
 */
export class SummaryStore {
  constructor(private db: any) {}

  /**
   * Create a summary
   */
  create(sessionId: string, level: number, content: string, options: {
    parentId?: string;
    sourceMessageIds?: string[];
    sourceSummaryIds?: string[];
    modelUsed?: string;
  } = {}): Summary {
    const id = `sum_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const tokens = Math.ceil(content.length / 4);
    
    this.db.run(
      `INSERT INTO summaries (id, session_id, parent_id, level, content, source_message_ids, source_summary_ids, tokens, created_at, model_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionId,
        options.parentId || null,
        level,
        content,
        JSON.stringify(options.sourceMessageIds || []),
        JSON.stringify(options.sourceSummaryIds || []),
        tokens,
        now,
        options.modelUsed || null,
      ]
    );
    
    return {
      id,
      sessionId,
      parentId: options.parentId,
      level,
      content,
      sourceMessageIds: options.sourceMessageIds || [],
      sourceSummaryIds: options.sourceSummaryIds || [],
      tokens,
      createdAt: now,
      modelUsed: options.modelUsed,
    };
  }

  /**
   * Get summary by ID
   */
  get(summaryId: string): Summary | undefined {
    const row = this.db.get(
      `SELECT * FROM summaries WHERE id = ?`,
      [summaryId]
    );
    
    if (!row) return undefined;
    return this.mapRowToSummary(row);
  }

  /**
   * Get summaries for a session at a specific level
   */
  getByLevel(sessionId: string, level: number): Summary[] {
    const rows = this.db.query(
      `SELECT * FROM summaries WHERE session_id = ? AND level = ? ORDER BY created_at ASC`,
      [sessionId, level]
    );
    
    return rows.map((row: any) => this.mapRowToSummary(row));
  }

  /**
   * Get all summaries for a session (all levels)
   */
  getBySession(sessionId: string): Summary[] {
    const rows = this.db.query(
      `SELECT * FROM summaries WHERE session_id = ? ORDER BY level ASC, created_at ASC`,
      [sessionId]
    );
    
    return rows.map((row: any) => this.mapRowToSummary(row));
  }

  /**
   * Get the latest summary at each level
   */
  getLatestByLevel(sessionId: string): Summary[] {
    const rows = this.db.query(
      `SELECT * FROM summaries s1
       WHERE s1.session_id = ?
       AND s1.created_at = (
         SELECT MAX(s2.created_at)
         FROM summaries s2
         WHERE s2.session_id = s1.session_id
         AND s2.level = s1.level
       )
       AND s1.id = (
         SELECT s3.id FROM summaries s3
         WHERE s3.session_id = s1.session_id
         AND s3.level = s1.level
         AND s3.created_at = s1.created_at
         ORDER BY s3.id DESC
         LIMIT 1
       )
       ORDER BY s1.level ASC`,
      [sessionId]
    );
    
    return rows.map((row: any) => this.mapRowToSummary(row));
  }

  /**
   * Get DAG depth (max level)
   */
  getMaxLevel(sessionId: string): number {
    const result = this.db.get(
      `SELECT MAX(level) as max_level FROM summaries WHERE session_id = ?`,
      [sessionId]
    ) as { max_level: number } | undefined;
    
    return result?.max_level ?? 0;
  }

  /**
   * Get total tokens in summaries
   */
  getTotalTokens(sessionId: string): number {
    const result = this.db.get(
      `SELECT SUM(tokens) as total FROM summaries WHERE session_id = ?`,
      [sessionId]
    ) as { total: number } | undefined;
    
    return result?.total ?? 0;
  }

  /**
   * Get messages that need summarization (not compacted, older than fresh tail)
   */
  getMessagesToSummarize(sessionId: string, freshTailCount: number, limit: number = 100): Array<{ id: string; content: string; tokens: number }> {
    const rows = this.db.query(
      `SELECT id, content, tokens FROM messages 
       WHERE session_id = ? AND is_compacted = 0 
       ORDER BY created_at ASC 
       LIMIT ? OFFSET ?`,
      [sessionId, limit, freshTailCount]
    );
    
    return rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      tokens: row.tokens,
    }));
  }

  /**
   * Count summaries by level
   */
  countByLevel(sessionId: string): Record<number, number> {
    const rows = this.db.query(
      `SELECT level, COUNT(*) as count FROM summaries WHERE session_id = ? GROUP BY level`,
      [sessionId]
    );
    
    const result: Record<number, number> = {};
    rows.forEach((row: any) => {
      result[row.level] = row.count;
    });
    
    return result;
  }

  /**
   * Delete summaries (for testing)
   */
  deleteBySession(sessionId: string): number {
    const result = this.db.run(
      `DELETE FROM summaries WHERE session_id = ?`,
      [sessionId]
    );
    
    return result.changes;
  }

  /**
   * Map database row to Summary object
   */
  private mapRowToSummary(row: any): Summary {
    return {
      id: row.id,
      sessionId: row.session_id,
      parentId: row.parent_id,
      level: row.level,
      content: row.content,
      sourceMessageIds: JSON.parse(row.source_message_ids || '[]'),
      sourceSummaryIds: JSON.parse(row.source_summary_ids || '[]'),
      tokens: row.tokens,
      createdAt: row.created_at,
      modelUsed: row.model_used,
    };
  }
}
