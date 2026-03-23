/**
 * Quantum Memory - Recall Tool
 * 
 * Manual memory recall for finding relevant past messages.
 * Uses SearchEngine for FTS5/BM25 search, NOT MemoryInjectStore.
 * 
 * IMPLEMENTATION NOTE:
 * MemoryInjectStore is for recording auto-recall injections for feedback tracking.
 * It does NOT have a search() method. Use SearchEngine for actual search.
 * 
 * @see src/search/SearchEngine.ts - search() method
 * @see IMPLEMENTATION_PLAN.md Phase 0.2
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
  limit: Type.Optional(
    Type.Number({
      description: "Maximum results to return (default: 10, max: 50)",
      minimum: 1,
      maximum: 50,
    })
  ),
  includeCompacted: Type.Optional(
    Type.Boolean({
      description: "Include messages from compacted summaries (default: true)",
    })
  ),
});

/**
 * Create recall tool for Quantum Memory
 * 
 * @param deps.searchEngine - SearchEngine instance for FTS5/BM25 search
 * @param deps.sessionIdGetter - Function to get current session ID
 */
export function createQmRecallTool(deps: {
  searchEngine: any;  // SearchEngine type - use 'any' for flexibility
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_recall",
    description: "Manually recall relevant memories from past conversation using full-text search",
    inputSchema: QmRecallSchema,
    
    async execute(input: {
      query: string;
      sessionId?: string;
      limit?: number;
      includeCompacted?: boolean;
    }) {
      // Resolve session ID (use current if not specified)
      const sessionId = input.sessionId ?? deps.sessionIdGetter();
      const limit = Math.min(input.limit ?? 10, 50);
      
      // Use SearchEngine.search() for FTS5/BM25 search
      // This returns SearchResult[] with: id, sessionId, content, role, score, highlights
      const results = deps.searchEngine.search(sessionId, input.query, {
        limit,
        includeCompacted: input.includeCompacted ?? true,
      });
      
      // Map SearchResult to output format
      return {
        memories: results.map((r: any) => ({
          id: r.id,
          content: r.content,
          role: r.role,
          score: r.score,
          highlights: r.highlights,
        })),
        total: results.length,
        query: input.query,
        sessionId,
      };
    },
  };
}
