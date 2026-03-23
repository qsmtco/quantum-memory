/**
 * Quantum Memory - Auto Recall Injector
 * 
 * Retrieves and injects relevant memories before AI response.
 * Enhanced with lineage metadata for DAG-aware context.
 * 
 * Phase 4: Added LineageTraverser integration for DAG metadata
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 4
 */

import { SearchEngine } from '../search/SearchEngine.js';
import { EntityStore } from '../entities/EntityStore.js';
import { MemoryInjectStore } from './MemoryInjectStore.js';
import type { LineageTraverser } from '../dag/LineageTraverser.js';
import { estimateTokens } from '../trim/types.js';

export interface InjectResult {
  /** Injected content */
  content: string;
  /** IDs of source messages */
  sourceIds: string[];
  /** Token count of injected content */
  tokenCount: number;
  /** Phase 4: Lineage metadata for each injection */
  lineage?: InjectionLineage[];
}

export interface InjectionLineage {
  /** Summary ID if memory came from summary */
  summaryId?: string;
  /** Summary level in DAG */
  summaryLevel?: number;
  /** Chain of ancestor summary IDs */
  ancestorIds?: string[];
  /** Score from search */
  score: number;
}

export interface EnrichedSearchResult {
  id: string;
  content: string;
  score: number;
  summaryId?: string;
  summaryLevel?: number;
  ancestorIds?: string[];
}

/**
 * AutoRecallInjector - retrieves and injects relevant memories
 * 
 * Now with lineage metadata from LineageTraverser.
 */
export class AutoRecallInjector {
  constructor(
    private searchEngine: SearchEngine,
    private entityStore: EntityStore,
    private injectStore: MemoryInjectStore,
    private lineageTraverser?: LineageTraverser,  // Phase 4: Optional lineage support
    private maxTokens: number = 1000
  ) {}

  /**
   * Inject relevant memories before response
   * Phase 4: Includes lineage metadata for each injection
   */
  inject(sessionId: string, recentContext: string, options?: {
    maxTokens?: number;
  }): InjectResult | null {
    const maxTokens = options?.maxTokens ?? this.maxTokens;
    
    // Build query from recent context
    const query = this.buildQuery(recentContext);
    if (!query) return null;
    
    // Search for relevant memories
    const searchResults = this.searchEngine.search(sessionId, query, {
      limit: 5,
    });
    
    if (searchResults.length === 0) return null;
    
    // Phase 4: Enrich with lineage metadata if available
    const enriched = this.enrichWithLineage(sessionId, searchResults);
    
    // Build context from results
    const content: string[] = [];
    const sourceIds: string[] = [];
    const lineage: InjectionLineage[] = [];
    let tokenCount = 0;
    
    for (const result of enriched) {
      const tokens = estimateTokens(result.content);
      if (tokenCount + tokens > maxTokens) break;
      
      // Phase 4: Include lineage in content if available
      const memoryLine = this.formatMemoryWithLineage(result);
      content.push(memoryLine);
      sourceIds.push(result.id);
      lineage.push({
        summaryId: result.summaryId,
        summaryLevel: result.summaryLevel,
        ancestorIds: result.ancestorIds,
        score: result.score,
      });
      tokenCount += tokens;
    }
    
    if (content.length === 0) return null;
    
    const finalContent = content.join('\n\n');
    
    // Record the injection for feedback tracking
    this.injectStore.record(sessionId, finalContent, sourceIds);
    
    return {
      content: finalContent,
      sourceIds,
      tokenCount,
      lineage,  // Phase 4: Include lineage in result
    };
  }

  /**
   * Inject by entity (e.g., inject all about "Project X")
   */
  injectByEntity(sessionId: string, entityName: string): InjectResult | null {
    const entities = this.entityStore.search(sessionId, entityName);
    if (entities.length === 0) return null;
    
    const entity = entities[0]!;
    const searchResults = this.searchEngine.search(sessionId, entity.name, {
      limit: 10,
    });
    
    if (searchResults.length === 0) return null;
    
    const enriched = this.enrichWithLineage(sessionId, searchResults);
    
    const content: string[] = [];
    const sourceIds: string[] = [];
    const lineage: InjectionLineage[] = [];
    let tokenCount = 0;
    
    for (const result of enriched.slice(0, 5)) {
      const tokens = estimateTokens(result.content);
      if (tokenCount + tokens > this.maxTokens) break;
      
      const memoryLine = this.formatMemoryWithLineage(result, entity.name);
      content.push(memoryLine);
      sourceIds.push(result.id);
      lineage.push({
        summaryId: result.summaryId,
        summaryLevel: result.summaryLevel,
        ancestorIds: result.ancestorIds,
        score: result.score,
      });
      tokenCount += tokens;
    }
    
    if (content.length === 0) return null;
    
    const finalContent = content.join('\n\n');
    this.injectStore.record(sessionId, finalContent, sourceIds);
    
    return {
      content: finalContent,
      sourceIds,
      tokenCount,
      lineage,
    };
  }

  /**
   * Phase 4: Enrich search results with lineage metadata
   */
  private enrichWithLineage(sessionId: string, searchResults: any[]): EnrichedSearchResult[] {
    if (!this.lineageTraverser) {
      // No lineage support - return basic results
      return searchResults.map(r => ({
        id: r.id,
        content: r.content,
        score: r.score,
      }));
    }
    
    // For each result, try to find which summary it belongs to
    const enriched: EnrichedSearchResult[] = [];
    
    for (const result of searchResults) {
      const item: EnrichedSearchResult = {
        id: result.id,
        content: result.content,
        score: result.score,  // Fixed: was r.score
      };
      
      // Phase 4: Try to find which summary this message belongs to
      // by checking all summaries at the session
      const summaries = this.findSummariesForMessage(sessionId, result.id);
      
      if (summaries.length > 0) {
        // Use the most recent (highest level) summary
        const latestSummary = summaries[summaries.length - 1]!;
        item.summaryId = latestSummary.id;
        item.summaryLevel = latestSummary.level;
        
        // Get ancestor chain
        const lineage = this.lineageTraverser.getLineage(latestSummary.id);
        item.ancestorIds = lineage.map(n => n.summary.id);
      }
      
      enriched.push(item);
    }
    
    return enriched;
  }

  /**
   * Phase 4: Find summaries that contain a specific message
   * Uses LineageTraverser.findSummariesForSessionMessage to search summaries
   * by their sourceMessageIds. Returns summaries sorted by level (ascending).
   */
  private findSummariesForMessage(sessionId: string, messageId: string): any[] {
    if (!this.lineageTraverser) return [];
    return this.lineageTraverser.findSummariesForSessionMessage(sessionId, messageId);
  }

  /**
   * Phase 4: Format memory with lineage metadata
   */
  private formatMemoryWithLineage(result: EnrichedSearchResult, entityName?: string): string {
    const prefix = entityName 
      ? `[Memory about ${entityName}]` 
      : '[Memory]';
    
    if (!result.summaryLevel) {
      return `${prefix} ${result.content}`;
    }
    
    // Include summary level for context
    const levelTag = `[L${result.summaryLevel}]`;
    return `${prefix} ${levelTag} ${result.content}`;
  }

  /**
   * Build search query from recent context
   */
  private buildQuery(context: string): string | null {
    const words = context
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    const query = words.slice(0, 5).join(' ');
    return query.length > 0 ? query : null;
  }

  /**
   * Get injection history
   */
  getHistory(sessionId: string, limit?: number) {
    return this.injectStore.getHistory(sessionId, limit ?? 10);
  }

  /**
   * Mark injection as useful (feedback loop)
   */
  markUseful(injectId: string, useful: boolean): boolean {
    return this.injectStore.markUseful(injectId, useful);
  }

  /**
   * Get usefulness stats
   */
  getStats(sessionId: string) {
    return this.injectStore.getStats(sessionId);
  }
}
