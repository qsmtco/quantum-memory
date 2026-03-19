/**
 * Quantum Memory - Recall Tool
 * 
 * Manual memory injection for specific recall.
 */

import { Type } from "@sinclair/typebox";

/**
 * Recall tool input schema
 */
export const QmRecallSchema = Type.Object({
  query: Type.String({
    description: "Query to find relevant memories",
  }),
  sessionId: Type.Optional(
    Type.String({
      description: "Session ID to search (defaults to current session)",
    })
  ),
  maxTokens: Type.Optional(
    Type.Number({
      description: "Maximum tokens for recalled content (default: 1000)",
      minimum: 100,
      maximum: 5000,
    })
  ),
});

/**
 * Create recall tool for Quantum Memory
 */
export function createQmRecallTool(deps: {
  memoryInjectStore: any;
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_recall",
    description: "Manually recall relevant memories from past conversation",
    inputSchema: QmRecallSchema,
    
    async execute(input: {
      query: string;
      sessionId?: string;
      maxTokens?: number;
    }) {
      const sessionId = input.sessionId ?? deps.sessionIdGetter();
      const maxTokens = input.maxTokens ?? 1000;
      
      // Get recall results from store
      const results = deps.memoryInjectStore.search(sessionId, input.query, {
        maxTokens,
      });
      
      return {
        memories: results.map((r: any) => ({
          id: r.id,
          content: r.content,
          sourceIds: r.sourceIds,
          injectedAt: r.injectedAt,
        })),
        total: results.length,
        query: input.query,
        sessionId,
      };
    },
  };
}
