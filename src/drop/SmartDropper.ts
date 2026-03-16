export interface DropRecord {
  id: string;
  sessionId: string;
  messageIds: string[];
  reason: string;
  droppedAt: string;
}

/**
 * SmartDropper - identifies and logs low-value content drops
 */
export class SmartDropper {
  constructor(private db: any) {}

  /**
   * Analyze messages for potential dropping
   */
  analyze(sessionId: string, threshold: number = 0.3): Array<{
    messageId: string;
    content: string;
    importanceScore: number;
    reason: string;
  }> {
    const rows = this.db.query(
      `SELECT id, content, importance_score FROM messages 
       WHERE session_id = ? AND is_compacted = 0`,
      [sessionId]
    );
    
    return rows
      .filter((row: any) => row.importance_score < threshold)
      .map((row: any) => ({
        messageId: row.id,
        content: row.content,
        importanceScore: row.importance_score,
        reason: this.getDropReason(row.importance_score),
      }));
  }

  /**
   * Drop low-value messages
   */
  drop(sessionId: string, threshold: number = 0.3, dryRun: boolean = false): {
    dropped: number;
    records: DropRecord[];
  } {
    const toDrop = this.analyze(sessionId, threshold);
    
    if (toDrop.length === 0) {
      return { dropped: 0, records: [] };
    }
    
    if (dryRun) {
      return { dropped: toDrop.length, records: [] };
    }
    
    // Mark as compacted (soft delete)
    const messageIds = toDrop.map(m => m.messageId);
    const placeholders = messageIds.map(() => '?').join(',');
    this.db.run(
      `UPDATE messages SET is_compacted = 1 WHERE id IN (${placeholders})`,
      messageIds
    );
    
    // Log the drop
    const record = this.logDrop(sessionId, messageIds, `Importance below ${threshold}`);
    
    return { dropped: messageIds.length, records: [record] };
  }

  /**
   * Log a drop operation
   */
  private logDrop(sessionId: string, messageIds: string[], reason: string): DropRecord {
    const id = `drop_${Date.now()}`;
    const now = new Date().toISOString();
    
    this.db.run(
      `INSERT INTO drop_log (id, session_id, message_ids, reason, dropped_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, sessionId, JSON.stringify(messageIds), reason, now]
    );
    
    return {
      id,
      sessionId,
      messageIds,
      reason,
      droppedAt: now,
    };
  }

  /**
   * Get drop log
   */
  getDropLog(sessionId: string, limit: number = 10): DropRecord[] {
    const rows = this.db.query(
      `SELECT * FROM drop_log WHERE session_id = ? ORDER BY dropped_at DESC LIMIT ?`,
      [sessionId, limit]
    );
    
    return rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      messageIds: JSON.parse(row.message_ids || '[]'),
      reason: row.reason,
      droppedAt: row.dropped_at,
    }));
  }

  /**
   * Get reason for drop based on score
   */
  private getDropReason(score: number): string {
    if (score < 0.1) return 'Very low importance (< 0.1)';
    if (score < 0.2) return 'Low importance (< 0.2)';
    return 'Below importance threshold';
  }
}
