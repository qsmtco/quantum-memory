/**
 * Quantum Memory - Lineage Tool
 * 
 * Tool for traversing the summary DAG hierarchy.
 * Allows agents to get ancestors, descendants, and expand summaries.
 * 
 * Actions:
 * - lineage: Get ancestors from summary to root
 * - descendants: Get all descendants (children, grandchildren, etc.)
 * - expand: Expand summary to original messages
 * - tree: Get summary tree for visualization
 * - stats: Get level statistics
 * 
 * @see src/dag/LineageTraverser.ts
 * @see docs/IMPLEMENTATION_PLAN.md Phase 3.3
 */

import { Type } from "@sinclair/typebox";

/**
 * Lineage tool input schema
 */
export const QmLineageSchema = Type.Object({
  action: Type.Union([
    Type.Literal("lineage"),      // Get ancestors from summary to root
    Type.Literal("descendants"),  // Get all descendants
    Type.Literal("expand"),       // Expand summary to original messages
    Type.Literal("tree"),         // Get summary tree for visualization
    Type.Literal("stats"),        // Get level statistics
    Type.Literal("find"),         // Find summaries mentioning entity
  ], {
    description: "Action to perform on the DAG",
  }),
  
  summaryId: Type.Optional(
    Type.String({
      description: "Summary ID (required for lineage, descendants, expand; optional for tree, stats)",
    })
  ),
  
  entityName: Type.Optional(
    Type.String({
      description: "Entity name to search for (for find action)",
    })
  ),
  
  maxDepth: Type.Optional(
    Type.Number({
      description: "Maximum depth for expand/tree (default: -1 for unlimited)",
      minimum: -1,
    })
  ),
  
  sessionId: Type.Optional(
    Type.String({
      description: "Session ID (defaults to current session)",
    })
  ),
});

/**
 * Create lineage tool for Quantum Memory
 * 
 * @param deps.lineageTraverser - LineageTraverser instance
 * @param deps.sessionIdGetter - Function to get current session ID
 */
export function createQmLineageTool(deps: {
  lineageTraverser: any;  // LineageTraverser type
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_lineage",
    description: "Traverse DAG lineage: get ancestors, descendants, expand summaries, view tree",
    inputSchema: QmLineageSchema,
    
    async execute(input: {
      action: 'lineage' | 'descendants' | 'expand' | 'tree' | 'stats' | 'find';
      summaryId?: string;
      entityName?: string;
      maxDepth?: number;
      sessionId?: string;
    }) {
      const sessionId = input.sessionId ?? deps.sessionIdGetter();
      
      switch (input.action) {
        case 'lineage': {
          if (!input.summaryId) {
            return { error: 'summaryId required for lineage action' };
          }
          const lineage = deps.lineageTraverser.getLineage(input.summaryId);
          return {
            action: 'lineage',
            summaryId: input.summaryId,
            lineage: lineage.map((n: any) => ({
              id: n.summary.id,
              level: n.summary.level,
              depth: n.depth,
              isRoot: n.isRoot,
              isLeaf: n.isLeaf,
              preview: n.summary.content.substring(0, 200),
              tokens: n.summary.tokens,
            })),
            totalLevels: lineage.length,
          };
        }
        
        case 'descendants': {
          if (!input.summaryId) {
            return { error: 'summaryId required for descendants action' };
          }
          const descendants = deps.lineageTraverser.getDescendants(input.summaryId);
          return {
            action: 'descendants',
            summaryId: input.summaryId,
            descendants: descendants.map((s: any) => ({
              id: s.id,
              level: s.level,
              preview: s.content.substring(0, 200),
              tokens: s.tokens,
            })),
            total: descendants.length,
          };
        }
        
        case 'expand': {
          if (!input.summaryId) {
            return { error: 'summaryId required for expand action' };
          }
          const maxDepth = input.maxDepth ?? -1;
          const result = deps.lineageTraverser.expand(input.summaryId, maxDepth);
          
          if (!result) {
            return { error: `Summary ${input.summaryId} not found` };
          }
          
          return {
            action: 'expand',
            summaryId: input.summaryId,
            summary: {
              id: result.summary.id,
              level: result.summary.level,
              content: result.summary.content,
              tokens: result.summary.tokens,
            },
            messages: result.messages.map((m: any) => ({
              id: m.id,
              role: m.role,
              preview: m.content.substring(0, 200),
              tokens: m.tokens,
            })),
            children: result.children.length,
            totalMessages: result.totalMessages,
            totalTokens: result.totalTokens,
          };
        }
        
        case 'tree': {
          const tree = deps.lineageTraverser.getTree(sessionId);
          return {
            action: 'tree',
            sessionId,
            tree,
          };
        }
        
        case 'stats': {
          const stats = deps.lineageTraverser.getLevelStats(sessionId);
          const statsObj: Record<string, any> = {};
          for (const [level, data] of stats.entries()) {
            statsObj[String(level)] = data;
          }
          return {
            action: 'stats',
            sessionId,
            stats: statsObj,
          };
        }
        
        case 'find': {
          if (!input.entityName) {
            return { error: 'entityName required for find action' };
          }
          const summaries = deps.lineageTraverser.findByEntity(sessionId, input.entityName);
          return {
            action: 'find',
            sessionId,
            entityName: input.entityName,
            summaries: summaries.map((s: any) => ({
              id: s.id,
              level: s.level,
              preview: s.content.substring(0, 200),
              tokens: s.tokens,
            })),
            total: summaries.length,
          };
        }
        
        default:
          return { error: `Unknown action: ${input.action}` };
      }
    },
  };
}
