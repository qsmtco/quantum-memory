export interface DropRecord {
  id: string;
  sessionId: string;
  messageIds: string[];
  reason: string;
  droppedAt: string;
}

export interface ImportanceScore {
  messageId: string;
  score: number;
  reasoning?: string;
}

/**
 * SmartDropper - identifies and logs low-value content drops.
 * Uses LLM for importance scoring when available, falls back to
 * keyword-based threshold filtering.
 */
export class SmartDropper {
  constructor(
    private db: any,
    private llmCaller?: { generate: (prompt: string, system?: string, opts?: any) => Promise<{ content: string }> }
  ) {}

  /**
   * Score messages using LLM importance evaluation.
   * Prompts the LLM to rate each message 0.0–1.0 with reasoning.
   * Falls back to keyword scoring if LLM unavailable.
   */
  async scoreMessages(sessionId: string): Promise<Map<string, ImportanceScore>> {
    const rows = this.db.query(
      `SELECT id, content, importance_score FROM messages
       WHERE session_id = ? AND is_compacted = 0
       ORDER BY created_at DESC LIMIT 20`,
      [sessionId]
    );

    const scores = new Map<string, ImportanceScore>();

    if (rows.length === 0) return scores;

    // Try LLM scoring if available
    if (this.llmCaller) {
      try {
        const messageList = rows.map((r: any, i: number) =>
          `${i + 1}. [${r.id}] ${r.content.slice(0, 300)}`
        ).join('\n');

        const prompt = `Rate the importance of each message for retaining conversation context.
Rate each 0.0 (disposable) to 1.0 (critical).
Respond with ONLY a JSON object: {"<message_id>": <score>} for each message.

Messages:\n${messageList}`;

        const response = await this.llmCaller.generate(prompt, 'You are a precise importance evaluator.');
        const content = response.content.trim();

        // Parse JSON response — extract first JSON-like block
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const [id, val] of Object.entries(parsed)) {
            const score = typeof val === 'number' ? val : parseFloat(String(val)) || 0.5;
            scores.set(id, { messageId: id, score: Math.max(0, Math.min(1, score)) });
          }
        }
      } catch (err) {
        console.warn('[SmartDropper] LLM scoring failed, using keyword fallback:', err);
      }
    }

    // Fill any missing scores with DB importance_score fallback (preserves manually-set scores)
    for (const row of rows) {
      if (!scores.has(row.id)) {
        // Use stored importance_score if available, else keyword fallback
        const dbScore = row.importance_score ?? this.keywordScore(row.content);
        scores.set(row.id, {
          messageId: row.id,
          score: dbScore,
        });
      }
    }

    return scores;
  }

  /**
   * Simple keyword-based importance score (0.0–1.0).
   * Used as fallback when LLM is unavailable.
   */
  private keywordScore(content: string): number {
    const lowValue = /\b(okay|ok|cool|nice|thanks?|sure|yes|no problem|dear|sir|madam|regards?)\b/gi;
    const highValue = /\b(fix|bug|error|important|decide|decision|agreed|rejected|failed|success|critical|must|should|need|will|won't)\b/gi;

    const low = (content.match(lowValue) || []).length;
    const high = (content.match(highValue) || []).length;
    const base = 0.5 + (high * 0.1) - (low * 0.05);
    return Math.max(0, Math.min(1, base));
  }

  /**
   * Determine which messages to drop based on importance scores.
   * Messages below threshold are candidates for dropping.
   */
  getMessagesToDrop(scores: Map<string, ImportanceScore>, threshold: number = 0.3): string[] {
    return Array.from(scores.entries())
      .filter(([, v]) => v.score < threshold)
      .map(([k]) => k);
  }

  /**
   * Analyze messages for potential dropping using stored importance_score.
   * Does NOT use LLM — uses DB column directly. For LLM scoring use scoreMessages().
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
   * Drop low-value messages.
   * Uses LLM scoring when available, keyword fallback otherwise.
   */
  async drop(sessionId: string, threshold: number = 0.3, dryRun: boolean = false): Promise<{
    dropped: number;
    records: DropRecord[];
  }> {
    const scores = await this.scoreMessages(sessionId);
    const toDrop = this.getMessagesToDrop(scores, threshold);

    if (toDrop.length === 0) {
      return { dropped: 0, records: [] };
    }

    if (dryRun) {
      return { dropped: toDrop.length, records: [] };
    }

    // Mark as compacted (soft delete)
    const placeholders = toDrop.map(() => '?').join(',');
    this.db.run(
      `UPDATE messages SET is_compacted = 1 WHERE id IN (${placeholders})`,
      toDrop
    );

    // Log the drop
    const avgScore = toDrop.length > 0
      ? toDrop.reduce((sum, id) => sum + (scores.get(id)?.score ?? 0.5), 0) / toDrop.length
      : 0.5;
    const record = this.logDrop(sessionId, toDrop, `LLM avg score: ${avgScore.toFixed(2)}, below ${threshold}`);

    return { dropped: toDrop.length, records: [record] };
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

    return { id, sessionId, messageIds, reason, droppedAt: now };
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
