import { randomUUID } from 'crypto';
import { estimateTokens } from '../trim/types.js';

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
  /** True if this summary was created by deterministic drop (no LLM/keywords) */
  isDeterministic?: boolean;
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
    modelUsed?: string;
    isDeterministic?: boolean;
  } = {}): Summary {
    const id = `sum_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const tokenCount = estimateTokens(content);
    
    this.db.run(
      `INSERT INTO summaries (id, session_id, parent_summary_id, level, content, source_message_ids, model_used, is_deterministic, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionId,
        options.parentId || null,
        level,
        content,
        JSON.stringify(options.sourceMessageIds || []),
        options.modelUsed || null,
        options.isDeterministic ? 1 : 0,
        tokenCount,
        now,
      ]
    );
    
    return {
      id,
      sessionId,
      parentId: options.parentId,
      level,
      content,
      sourceMessageIds: options.sourceMessageIds || [],
      sourceSummaryIds: [],
      tokens: tokenCount,
      createdAt: now,
      modelUsed: options.modelUsed,
      isDeterministic: options.isDeterministic,
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
   * Get summaries that have a specific parent (direct children)
   * Used by LineageTraverser for DAG traversal
   */
  getByParentId(parentId: string): Summary[] {
    const rows = this.db.query(
      `SELECT * FROM summaries WHERE parent_summary_id = ? ORDER BY created_at ASC`,
      [parentId]
    );
    
    return rows.map((row: any) => this.mapRowToSummary(row));
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
   * Uses a single correlated subquery to find the most recent summary per level.
   */
  getLatestByLevel(sessionId: string): Summary[] {
    const rows = this.db.query(
      `SELECT * FROM summaries s1
       WHERE s1.session_id = ?
       AND s1.id = (
         SELECT s2.id
         FROM summaries s2
         WHERE s2.session_id = s1.session_id
         AND s2.level = s1.level
         ORDER BY s2.created_at DESC, s2.id DESC
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
      `SELECT SUM(token_count) as total FROM summaries WHERE session_id = ?`,
      [sessionId]
    ) as { total: number } | undefined;
    
    return result?.total ?? 0;
  }

  /**
   * Get messages that need summarization (not compacted, older than fresh tail)
   * Includes role for Trimmer to determine trimming strategy
   */
  getMessagesToSummarize(sessionId: string, freshTailCount: number, limit: number = 100): Array<{ id: string; content: string; tokenCount: number; role: string }> {
    const rows = this.db.query(
      `SELECT id, content, token_count, role FROM messages 
       WHERE session_id = ? AND is_compacted = 0 
       ORDER BY created_at ASC 
       LIMIT ? OFFSET ?`,
      [sessionId, limit, freshTailCount]
    );
    
    return rows.map((row: any) => ({
      id: String(row.id),
      content: row.content,
      tokenCount: row.token_count,
      role: row.role,
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
      parentId: row.parent_summary_id,
      level: row.level,
      content: row.content,
      sourceMessageIds: JSON.parse(row.source_message_ids || '[]'),
      sourceSummaryIds: [],
      tokens: row.token_count,
      createdAt: row.created_at,
      modelUsed: row.model_used || undefined,
      isDeterministic: row.is_deterministic === 1,
    };
  }
}
