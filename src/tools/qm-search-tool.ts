/**
 * Quantum Memory - Search Tool
 * 
 * Provides full-text search over stored messages and summaries.
 * Follows lossless-claw tool pattern adapted for Quantum Memory.
 */

import { Type } from "@sinclair/typebox";

/**
 * Search tool input schema
 */
export const QmSearchSchema = Type.Object({
  query: Type.String({
    description: "Search query text to match against messages",
  }),
  sessionId: Type.Optional(
    Type.String({
      description: "Session ID to search within (defaults to current session)",
    })
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum results to return (default: 20, max: 100)",
      minimum: 1,
      maximum: 100,
    })
  ),
  includeCompacted: Type.Optional(
    Type.Boolean({
      description: "Include messages from compacted summaries (default: false)",
    })
  ),
});

/**
 * Tool result for search
 */
export interface QmSearchResult {
  results: Array<{
    id: string;
    content: string;
    role: string;
    score: number;
    snippet: string;
  }>;
  total: number;
  sessionId: string;
}

/**
 * Create search tool for Quantum Memory
 * 
 * @param deps - Dependencies including SearchEngine
 * @param sessionIdGetter - Function to get current session ID
 */
export function createQmSearchTool(deps: {
  searchEngine: any;
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_search",
    description: "Search messages in Quantum Memory by keyword",
    inputSchema: QmSearchSchema,
    
    async execute(input: {
      query: string;
      sessionId?: string;
      limit?: number;
      includeCompacted?: boolean;
    }): Promise<QmSearchResult> {
      const sessionId = input.sessionId ?? deps.sessionIdGetter();
      const limit = Math.min(input.limit ?? 20, 100);
      
      // Use existing SearchEngine
      const results = deps.searchEngine.search(sessionId, input.query, {
        limit,
        includeCompacted: input.includeCompacted ?? false,
      });
      
      return {
        results: results.map((r: any) => ({
          id: r.id,
          content: r.content,
          role: r.role,
          score: r.score ?? 1,
          snippet: r.content.substring(0, 200),
        })),
        total: results.length,
        sessionId,
      };
    },
  };
}
