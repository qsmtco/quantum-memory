import { randomUUID } from 'crypto';
import { estimateTokens } from '../trim/types.js';

// Re-export estimateTokens so existing importers don't break
export { estimateTokens };

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens: number;
  createdAt: string;
  importanceScore: number;
  isCompacted: boolean;
}

/**
 * MessageStore - handles message persistence
 */
export class MessageStore {
  constructor(private db: any) {}

  /**
   * Store a single message
   */
  create(sessionId: string, role: string, content: string): Message {
    const id = `msg_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const tokens = estimateTokens(content);
    
    this.db.run(
      `INSERT INTO messages (id, session_id, role, content, token_count, created_at, importance_score, is_compacted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, role, content, tokens, now, 0.5, 0]
    );
    
    return {
      id,
      sessionId,
      role: role as Message['role'],
      content,
      tokens,
      createdAt: now,
      importanceScore: 0.5,
      isCompacted: false,
    };
  }

  /**
   * Store multiple messages in a batch
   */
  createBatch(sessionId: string, messages: Array<{ role: string; content: string }>): Message[] {
    const now = new Date().toISOString();
    const created: Message[] = [];
    
    for (const msg of messages) {
      const id = `msg_${randomUUID().slice(0, 12)}`;
      const tokens = estimateTokens(msg.content);
      
      this.db.run(
        `INSERT INTO messages (id, session_id, role, content, token_count, created_at, importance_score, is_compacted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, sessionId, msg.role, msg.content, tokens, now, 0.5, 0]
      );
      
      created.push({
        id,
        sessionId,
        role: msg.role as Message['role'],
        content: msg.content,
        tokens,
        createdAt: now,
        importanceScore: 0.5,
        isCompacted: false,
      });
    }
    
    return created;
  }

  /**
   * Get message by ID
   */
  get(messageId: string): Message | undefined {
    const row = this.db.get(
      `SELECT * FROM messages WHERE id = ?`,
      [messageId]
    );
    
    if (!row) return undefined;
    return this.mapRowToMessage(row);
  }

  /**
   * Get messages for a session
   */
  getBySession(sessionId: string, options?: {
    limit?: number;
    offset?: number;
    includeCompacted?: boolean;
  }): Message[] {
    let sql = `SELECT * FROM messages WHERE session_id = ?`;
    const params: any[] = [sessionId];
    
    if (!options?.includeCompacted) {
      sql += ` AND is_compacted = 0`;
    }
    
    sql += ` ORDER BY created_at ASC`;
    
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    
    if (options?.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }
    
    const rows = this.db.query(sql, params);
    return rows.map((row: any) => this.mapRowToMessage(row));
  }

  /**
   * Get messages by their IDs
   * Used by KeywordCompactor and DeterministicDropper
   */
  getByIds(ids: string[]): Message[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT * FROM messages WHERE id IN (${placeholders})`;
    const rows = this.db.query(sql, ids);
    return rows.map((row: any) => this.mapRowToMessage(row));
  }

  /**
   * Get message count for a session
   */
  count(sessionId: string, includeCompacted = false): number {
    let sql = `SELECT COUNT(*) as count FROM messages WHERE session_id = ?`;
    const params: any[] = [sessionId];
    
    if (!includeCompacted) {
      sql += ` AND is_compacted = 0`;
    }
    
    const result = this.db.get(sql, params) as { count: number } | undefined;
    return result?.count ?? 0;
  }

  /**
   * Get total tokens for a session
   */
  getTotalTokens(sessionId: string): number {
    const result = this.db.get(
      `SELECT SUM(token_count) as total FROM messages WHERE session_id = ? AND is_compacted = 0`,
      [sessionId]
    ) as { total: number } | undefined;
    
    return result?.total ?? 0;
  }

  /**
   * Get the fresh tail (recent messages not compacted)
   */
  getFreshTail(sessionId: string, count: number): Message[] {
    const rows = this.db.query(
      `SELECT * FROM messages WHERE session_id = ? AND is_compacted = 0 ORDER BY created_at DESC LIMIT ?`,
      [sessionId, count]
    );
    
    // Return in chronological order
    return rows.map((row: any) => this.mapRowToMessage(row)).reverse();
  }

  /**
   * Mark messages as compacted
   */
  markCompacted(messageIds: string[]): number {
    if (messageIds.length === 0) return 0;
    
    const placeholders = messageIds.map(() => '?').join(',');
    const result = this.db.run(
      `UPDATE messages SET is_compacted = 1 WHERE id IN (${placeholders})`,
      messageIds
    );
    
    return result.changes;
  }

  /**
   * Update importance score for a message
   */
  updateImportance(messageId: string, score: number): boolean {
    const result = this.db.run(
      `UPDATE messages SET importance_score = ? WHERE id = ?`,
      [score, messageId]
    );
    
    return result.changes > 0;
  }

  /**
   * Get messages by importance score threshold
   */
  getByImportance(sessionId: string, threshold: number): Message[] {
    const rows = this.db.query(
      `SELECT * FROM messages WHERE session_id = ? AND importance_score < ? AND is_compacted = 0`,
      [sessionId, threshold]
    );
    
    return rows.map((row: any) => this.mapRowToMessage(row));
  }

  /**
   * Delete message by ID
   */
  delete(messageId: string): boolean {
    const result = this.db.run(
      `DELETE FROM messages WHERE id = ?`,
      [messageId]
    );
    
    return result.changes > 0;
  }

  /**
   * Map database row to Message object
   */
  private mapRowToMessage(row: any): Message {
    return {
      id: String(row.id),
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      tokens: row.token_count,
      createdAt: row.created_at,
      importanceScore: row.importance_score,
      isCompacted: row.is_compacted === 1,
    };
  }
}
