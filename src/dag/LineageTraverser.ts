/**
 * Quantum Memory - Lineage Traverser
 * 
 * Provides DAG traversal capabilities for the summary hierarchy.
 * Allows agents to navigate ancestors, descendants, and expand summaries.
 * 
 * Based on CMV (Contextual Memory Virtualisation) research:
 * - Paper: https://arxiv.org/abs/2602.22402
 * - "Lineage pointers enable traversal without guesswork"
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 3.1
 */

import type { Summary } from './SummaryStore.js';
import type { Message } from '../engine/MessageStore.js';
import { estimateTokens } from '../trim/types.js';

/**
 * A node in the lineage chain
 */
export interface LineageNode {
  /** Summary at this level */
  summary: Summary;
  /** Distance from the starting summary (0 = starting point) */
  depth: number;
  /** True if this is the root (no parent) */
  isRoot: boolean;
  /** True if this is the leaf (starting point) */
  isLeaf: boolean;
}

/**
 * Result of expanding a summary to its original messages
 */
export interface ExpansionResult {
  /** Summary that was expanded */
  summaryId: string;
  /** Summary content */
  summary: Summary;
  /** Original messages at this level */
  messages: Message[];
  /** Child expansions (recursive) */
  children: ExpansionResult[];
  /** Total messages in this subtree */
  totalMessages: number;
  /** Total estimated tokens in this subtree */
  totalTokens: number;
}

/**
 * A node in the summary tree (for visualization)
 */
export interface SummaryTreeNode {
  /** Summary ID */
  id: string;
  /** Summary level in DAG */
  level: number;
  /** Preview of content */
  preview: string;
  /** Estimated tokens */
  tokens: number;
  /** Child summaries */
  children: SummaryTreeNode[];
}

/**
 * LineageTraverser - DAG traversal for summaries
 * 
 * Provides methods to:
 * - Get lineage chain (ancestors from summary to root)
 * - Get all descendants
 * - Expand summary to original messages (recursive)
 * - Get summary tree for visualization
 */
export class LineageTraverser {
  constructor(
    private summaryStore: {
      get: (summaryId: string) => Summary | undefined;
      getByParentId: (parentId: string) => Summary[];
      getBySession: (sessionId: string) => Summary[];
      getMaxLevel: (sessionId: string) => number;
    },
    private messageStore: {
      getByIds: (ids: string[]) => Message[];
      getBySession: (sessionId: string, options?: any) => Message[];
    },
  ) {}

  /**
   * Get full lineage chain from a summary to the root (ancestors)
   * 
   * Returns array of LineageNode from leaf (starting point) to root.
   * 
   * @param summaryId - Starting summary ID
   * @returns Array of lineage nodes, oldest first
   */
  getLineage(summaryId: string): LineageNode[] {
    const chain: LineageNode[] = [];
    let current = this.summaryStore.get(summaryId);
    let depth = 0;
    
    while (current) {
      chain.push({
        summary: current,
        depth,
        isRoot: !current.parentId,
        isLeaf: depth === 0,
      });
      
      if (!current.parentId) break;
      current = this.summaryStore.get(current.parentId);
      depth++;
    }
    
    return chain; // [leaf, ...ancestors, root]
  }

  /**
   * Get all descendants of a summary (children, grandchildren, etc.)
   * Uses BFS to traverse the DAG downward.
   * 
   * @param summaryId - Starting summary ID
   * @returns Array of all descendant summaries
   */
  getDescendants(summaryId: string): Summary[] {
    const descendants: Summary[] = [];
    const queue = [summaryId];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = this.summaryStore.getByParentId(currentId);
      descendants.push(...children);
      queue.push(...children.map(c => c.id));
    }
    
    return descendants;
  }

  /**
   * Expand a summary to its original messages, recursively including children
   * 
   * @param summaryId - Summary to expand
   * @param maxDepth - Maximum recursion depth (-1 for unlimited)
   * @returns Expansion result with messages and child expansions
   */
  expand(summaryId: string, maxDepth: number = -1): ExpansionResult | null {
    const summary = this.summaryStore.get(summaryId);
    if (!summary) return null;
    
    // Get direct messages at this level
    const sourceIds = summary.sourceMessageIds || [];
    const messages = this.messageStore.getByIds(sourceIds);
    
    // Recursively expand children if within depth limit
    const children: ExpansionResult[] = [];
    if (maxDepth !== 0) {
      const childSummaries = this.summaryStore.getByParentId(summaryId);
      for (const child of childSummaries) {
        const childResult = this.expand(child.id, maxDepth - 1);
        if (childResult) {
          children.push(childResult);
        }
      }
    }
    
    // Calculate totals
    const totalMessages = messages.length + 
      children.reduce((sum, c) => sum + c.totalMessages, 0);
    const totalTokens = messages.reduce((sum, m) => sum + (m.tokens || estimateTokens(m.content)), 0) +
      children.reduce((sum, c) => sum + c.totalTokens, 0);
    
    return {
      summaryId,
      summary,
      messages,
      children,
      totalMessages,
      totalTokens,
    };
  }

  /**
   * Find summaries containing a specific entity
   * Uses simple substring matching on summary content.
   * 
   * @param sessionId - Session to search
   * @param entityName - Entity name to find
   * @returns Summaries mentioning the entity
   */
  findByEntity(sessionId: string, entityName: string): Summary[] {
    const allSummaries = this.summaryStore.getBySession(sessionId);
    const normalizedEntity = entityName.toLowerCase();
    
    return allSummaries.filter(s => 
      s.content.toLowerCase().includes(normalizedEntity)
    );
  }

  /**
   * Get summary tree for visualization
   * 
   * Returns a tree structure showing the DAG hierarchy.
   * 
   * @param sessionId - Session to visualize
   * @returns Root node with children
   */
  getTree(sessionId: string): SummaryTreeNode {
    const summaries = this.summaryStore.getBySession(sessionId);
    
    // Find roots (summaries with no parent)
    const roots = summaries.filter(s => !s.parentId);
    
    // Build tree recursively
    const buildNode = (summary: Summary): SummaryTreeNode => {
      const children = summaries
        .filter(s => s.parentId === summary.id)
        .map(buildNode);
      
      return {
        id: summary.id,
        level: summary.level,
        preview: summary.content.substring(0, 100),
        tokens: summary.tokens,
        children,
      };
    };
    
    return {
      id: 'root',
      level: -1,
      preview: `Session ${sessionId}`,
      tokens: summaries.reduce((sum, s) => sum + s.tokens, 0),
      children: roots.map(buildNode),
    };
  }

  /**
   * Get summary level statistics for a session
   * 
   * @param sessionId - Session to analyze
   * @returns Map of level -> count and token stats
   */
  getLevelStats(sessionId: string): Map<number, { count: number; totalTokens: number; totalMessages: number }> {
    const summaries = this.summaryStore.getBySession(sessionId);
    const stats = new Map<number, { count: number; totalTokens: number; totalMessages: number }>();
    
    for (const summary of summaries) {
      const existing = stats.get(summary.level) || { count: 0, totalTokens: 0, totalMessages: 0 };
      existing.count++;
      existing.totalTokens += summary.tokens;
      existing.totalMessages += (summary.sourceMessageIds?.length || 0);
      stats.set(summary.level, existing);
    }
    
    return stats;
  }

  /**
   * Find summaries for a specific session that contain a given message ID.
   * Returns summaries sorted by level (ascending).
   * Used by AutoRecallInjector to determine which summary a message belongs to.
   * 
   * @param sessionId - Session to search
   * @param messageId - Message ID to find
   * @returns Matching summaries, sorted by level ascending
   */
  findSummariesForSessionMessage(sessionId: string, messageId: string): Summary[] {
    const summaries = this.summaryStore.getBySession(sessionId);
    const matching = summaries.filter(s => 
      s.sourceMessageIds && s.sourceMessageIds.includes(messageId)
    );
    return matching.sort((a, b) => a.level - b.level);
  }
}
