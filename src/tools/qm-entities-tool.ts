/**
 * Quantum Memory - Entities Tool
 * 
 * Lists extracted entities from messages.
 */

import { Type } from "@sinclair/typebox";

/**
 * Entities tool input schema
 */
export const QmEntitiesSchema = Type.Object({
  sessionId: Type.Optional(
    Type.String({
      description: "Session ID to list entities from (defaults to current session)",
    })
  ),
  type: Type.Optional(
    Type.String({
      description: "Filter by entity type: person, project, tool, concept, decision, preference",
    })
  ),
  minMentions: Type.Optional(
    Type.Number({
      description: "Minimum number of mentions (default: 1)",
      minimum: 1,
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
 * Create entities tool for Quantum Memory
 */
export function createQmEntitiesTool(deps: {
  entityStore: any;
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_entities",
    description: "List extracted entities (persons, projects, tools, concepts) from conversation",
    inputSchema: QmEntitiesSchema,
    
    async execute(input: {
      sessionId?: string;
      type?: string;
      minMentions?: number;
      limit?: number;
    }) {
      const sessionId = input.sessionId ?? deps.sessionIdGetter();
      const limit = Math.min(input.limit ?? 50, 200);
      
      // Get entities from store
      const entities = deps.entityStore.getBySession(sessionId, {
        type: input.type,
        minMentions: input.minMentions ?? 1,
        limit,
      });
      
      return {
        entities: entities.map((e: any) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          mentionCount: e.mentionCount,
          firstSeen: e.firstSeen,
          lastSeen: e.lastSeen,
        })),
        total: entities.length,
        sessionId,
      };
    },
  };
}
