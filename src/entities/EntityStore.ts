import { randomUUID } from 'crypto';
import { validateSessionId, validateEntityName, validateEntityType } from '../utils/validators.js';

export interface Entity {
  id: string;
  sessionId: string;
  name: string;
  type: 'person' | 'project' | 'tool' | 'concept' | string;
  firstSeen: string;
  lastSeen?: string;
  mentionCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * EntityStore - manages entity persistence
 */
export class EntityStore {
  constructor(private db: any) {}

  /**
   * Create or update an entity (upsert)
   */
  upsert(sessionId: string, name: string, type: string, metadata?: Record<string, unknown>): Entity {
    validateSessionId(sessionId);
    validateEntityName(name);
    validateEntityType(type);

    const existing = this.findByName(sessionId, name, type);
    const now = new Date().toISOString();
    
    if (existing) {
      // Update existing
      this.db.run(
        `UPDATE entities SET last_seen = ?, mention_count = mention_count + 1 WHERE id = ?`,
        [now, existing.id]
      );
      return this.get(existing.id)!;
    }
    
    // Create new
    const id = `ent_${randomUUID().slice(0, 12)}`;
    this.db.run(
      `INSERT INTO entities (id, session_id, name, type, first_seen, last_seen, mention_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, name, type, now, now, 1, metadata ? JSON.stringify(metadata) : null]
    );
    
    return {
      id,
      sessionId,
      name,
      type,
      firstSeen: now,
      lastSeen: now,
      mentionCount: 1,
      metadata,
    };
  }

  /**
   * Get entity by ID
   */
  get(entityId: string): Entity | undefined {
    const row = this.db.get(
      `SELECT * FROM entities WHERE id = ?`,
      [entityId]
    );
    
    if (!row) return undefined;
    return this.mapRowToEntity(row);
  }

  /**
   * Find entity by name and type
   */
  findByName(sessionId: string, name: string, type: string): Entity | undefined {
    const row = this.db.get(
      `SELECT * FROM entities WHERE session_id = ? AND name = ? AND type = ?`,
      [sessionId, name, type]
    );
    
    if (!row) return undefined;
    return this.mapRowToEntity(row);
  }

  /**
   * Get all entities for a session
   */
  getBySession(sessionId: string, options?: {
    type?: string;
    minMentions?: number;
    limit?: number;
  }): Entity[] {
    let sql = `SELECT * FROM entities WHERE session_id = ?`;
    const params: any[] = [sessionId];
    
    if (options?.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }
    
    if (options?.minMentions) {
      sql += ` AND mention_count >= ?`;
      params.push(options.minMentions);
    }
    
    sql += ` ORDER BY mention_count DESC`;
    
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    
    const rows = this.db.query(sql, params);
    return rows.map((row: any) => this.mapRowToEntity(row));
  }

  /**
   * Get entities by type
   */
  getByType(sessionId: string, type: string): Entity[] {
    return this.getBySession(sessionId, { type });
  }

  /**
   * Get entity count by type
   */
  countByType(sessionId: string): Record<string, number> {
    const rows = this.db.query(
      `SELECT type, COUNT(*) as count FROM entities WHERE session_id = ? GROUP BY type`,
      [sessionId]
    );
    
    const result: Record<string, number> = {};
    rows.forEach((row: any) => {
      result[row.type] = row.count;
    });
    
    return result;
  }

  /**
   * Search entities by name pattern
   */
  search(sessionId: string, pattern: string): Entity[] {
    const rows = this.db.query(
      `SELECT * FROM entities WHERE session_id = ? AND name LIKE ? ORDER BY mention_count DESC LIMIT 20`,
      [sessionId, `%${pattern}%`]
    );
    
    return rows.map((row: any) => this.mapRowToEntity(row));
  }

  /**
   * Delete entity
   */
  delete(entityId: string): boolean {
    const result = this.db.run(
      `DELETE FROM entities WHERE id = ?`,
      [entityId]
    );
    
    return result.changes > 0;
  }

  /**
   * Delete all entities for a session
   */
  deleteBySession(sessionId: string): number {
    const result = this.db.run(
      `DELETE FROM entities WHERE session_id = ?`,
      [sessionId]
    );
    
    return result.changes;
  }

  /**
   * Map database row to Entity
   */
  private mapRowToEntity(row: any): Entity {
    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      type: row.type,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      mentionCount: row.mention_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
