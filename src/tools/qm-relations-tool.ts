/**
 * Quantum Memory - Relations Tool
 * 
 * Lists knowledge graph relationships between entities.
 */

import { Type } from "@sinclair/typebox";

/**
 * Relations tool input schema
 */
export const QmRelationsSchema = Type.Object({
  sessionId: Type.Optional(
    Type.String({
      description: "Session ID to list relations from (defaults to current session)",
    })
  ),
  fromEntity: Type.Optional(
    Type.String({
      description: "Filter by source entity name",
    })
  ),
  toEntity: Type.Optional(
    Type.String({
      description: "Filter by target entity name",
    })
  ),
  type: Type.Optional(
    Type.String({
      description: "Filter by relation type: knows, depends_on, uses, created_by, decided, prefers",
    })
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum results (default: 50, max: 200)",
      minimum: 1,
      maximum: 200,
    })
  ),
});

/**
 * Create relations tool for Quantum Memory
 */
export function createQmRelationsTool(deps: {
  relationStore: any;
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_relations",
    description: "List knowledge graph relationships between extracted entities",
    inputSchema: QmRelationsSchema,
    
    async execute(input: {
      sessionId?: string;
      fromEntity?: string;
      toEntity?: string;
      type?: string;
      limit?: number;
    }) {
      const sessionId = input.sessionId ?? deps.sessionIdGetter();
      const limit = Math.min(input.limit ?? 50, 200);
      
      // Get relations from store
      const relations = deps.relationStore.getBySession(sessionId, {
        fromEntity: input.fromEntity,
        toEntity: input.toEntity,
        type: input.type,
        limit,
      });
      
      return {
        relations: relations.map((r: any) => ({
          id: r.id,
          fromEntity: r.fromEntity,
          toEntity: r.toEntity,
          type: r.type,
          confidence: r.confidence,
          sourceMessageId: r.sourceMessageId,
        })),
        total: relations.length,
        sessionId,
      };
    },
  };
}
