import { randomUUID } from 'crypto';

export interface Relation {
  id: string;
  sessionId: string;
  fromEntityId: string;
  toEntityId: string;
  relationship: string;
  confidence: number;
  sourceMessageId?: string;
  createdAt: string;
}

/**
 * RelationStore - manages knowledge graph relations
 */
export class RelationStore {
  constructor(private db: any) {}

  /**
   * Create a relation
   */
  create(sessionId: string, fromEntityId: string, toEntityId: string, relationship: string, options?: {
    confidence?: number;
    sourceMessageId?: string;
  }): Relation {
    const id = `rel_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    
    this.db.run(
      `INSERT INTO relations (id, session_id, from_entity_id, to_entity_id, relationship, confidence, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, fromEntityId, toEntityId, relationship, options?.confidence ?? 1.0, options?.sourceMessageId ?? null, now]
    );
    
    return {
      id,
      sessionId,
      fromEntityId,
      toEntityId,
      relationship,
      confidence: options?.confidence ?? 1.0,
      sourceMessageId: options?.sourceMessageId,
      createdAt: now,
    };
  }

  /**
   * Get relation by ID
   */
  get(relationId: string): Relation | undefined {
    const row = this.db.get(
      `SELECT * FROM relations WHERE id = ?`,
      [relationId]
    );
    
    if (!row) return undefined;
    return this.mapRowToRelation(row);
  }

  /**
   * Get relations for an entity (as source or target)
   */
  getByEntity(entityId: string): Relation[] {
    const rows = this.db.query(
      `SELECT * FROM relations WHERE from_entity_id = ? OR to_entity_id = ? ORDER BY created_at DESC`,
      [entityId, entityId]
    );
    
    return rows.map((row: any) => this.mapRowToRelation(row));
  }

  /**
   * Get outgoing relations from an entity
   */
  getOutgoing(entityId: string): Relation[] {
    const rows = this.db.query(
      `SELECT * FROM relations WHERE from_entity_id = ? ORDER BY created_at DESC`,
      [entityId]
    );
    
    return rows.map((row: any) => this.mapRowToRelation(row));
  }

  /**
   * Get incoming relations to an entity
   */
  getIncoming(entityId: string): Relation[] {
    const rows = this.db.query(
      `SELECT * FROM relations WHERE to_entity_id = ? ORDER BY created_at DESC`,
      [entityId]
    );
    
    return rows.map((row: any) => this.mapRowToRelation(row));
  }

  /**
   * Get relations by type
   */
  getByType(sessionId: string, relationship: string): Relation[] {
    const rows = this.db.query(
      `SELECT * FROM relations WHERE session_id = ? AND relationship = ? ORDER BY confidence DESC`,
      [sessionId, relationship]
    );
    
    return rows.map((row: any) => this.mapRowToRelation(row));
  }

  /**
   * Get all relations for a session
   */
  getBySession(sessionId: string): Relation[] {
    const rows = this.db.query(
      `SELECT * FROM relations WHERE session_id = ? ORDER BY created_at DESC`,
      [sessionId]
    );
    
    return rows.map((row: any) => this.mapRowToRelation(row));
  }

  /**
   * Check if relation exists
   */
  exists(fromEntityId: string, toEntityId: string, relationship: string): boolean {
    const row = this.db.get(
      `SELECT id FROM relations WHERE from_entity_id = ? AND to_entity_id = ? AND relationship = ?`,
      [fromEntityId, toEntityId, relationship]
    );
    
    return !!row;
  }

  /**
   * Update confidence
   */
  updateConfidence(relationId: string, confidence: number): boolean {
    const result = this.db.run(
      `UPDATE relations SET confidence = ? WHERE id = ?`,
      [confidence, relationId]
    );
    
    return result.changes > 0;
  }

  /**
   * Delete relation
   */
  delete(relationId: string): boolean {
    const result = this.db.run(
      `DELETE FROM relations WHERE id = ?`,
      [relationId]
    );
    
    return result.changes > 0;
  }

  /**
   * Delete all relations for a session
   */
  deleteBySession(sessionId: string): number {
    const result = this.db.run(
      `DELETE FROM relations WHERE session_id = ?`,
      [sessionId]
    );
    
    return result.changes;
  }

  /**
   * Get relation count by type
   */
  countByType(sessionId: string): Record<string, number> {
    const rows = this.db.query(
      `SELECT relationship, COUNT(*) as count FROM relations WHERE session_id = ? GROUP BY relationship`,
      [sessionId]
    );
    
    const result: Record<string, number> = {};
    rows.forEach((row: any) => {
      result[row.relationship] = row.count;
    });
    
    return result;
  }

  /**
   * Map database row to Relation
   */
  private mapRowToRelation(row: any): Relation {
    return {
      id: row.id,
      sessionId: row.session_id,
      fromEntityId: row.from_entity_id,
      toEntityId: row.to_entity_id,
      relationship: row.relationship,
      confidence: row.confidence,
      sourceMessageId: row.source_message_id,
      createdAt: row.created_at,
    };
  }
}
