import { SearchEngine } from '../search/SearchEngine.js';
import { EntityStore } from '../entities/EntityStore.js';
import { MemoryInjectStore } from './MemoryInjectStore.js';

export interface InjectResult {
  content: string;
  sourceIds: string[];
  tokenCount: number;
}

/**
 * AutoRecallInjector - retrieves and injects relevant memories
 */
export class AutoRecallInjector {
  constructor(
    private searchEngine: SearchEngine,
    private entityStore: EntityStore,
    private injectStore: MemoryInjectStore,
    private maxTokens: number = 1000
  ) {}

  /**
   * Inject relevant memories before response
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
    
    // Build context from results
    const content: string[] = [];
    const sourceIds: string[] = [];
    let tokenCount = 0;
    
    for (const result of searchResults) {
      const tokens = Math.ceil(result.content.length / 4);
      if (tokenCount + tokens > maxTokens) break;
      
      content.push(`[Memory] ${result.content}`);
      sourceIds.push(result.id);
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
    };
  }

  /**
   * Inject by entity (e.g., inject all about "Project X")
   */
  injectByEntity(sessionId: string, entityName: string): InjectResult | null {
    const entities = this.entityStore.search(sessionId, entityName);
    if (entities.length === 0) return null;
    
    const entity = entities[0];
    const searchResults = this.searchEngine.search(sessionId, entity.name, {
      limit: 10,
    });
    
    if (searchResults.length === 0) return null;
    
    const content: string[] = [];
    const sourceIds: string[] = [];
    let tokenCount = 0;
    
    for (const result of searchResults.slice(0, 5)) {
      const tokens = Math.ceil(result.content.length / 4);
      if (tokenCount + tokens > this.maxTokens) break;
      
      content.push(`[Memory about ${entity.name}] ${result.content}`);
      sourceIds.push(result.id);
      tokenCount += tokens;
    }
    
    if (content.length === 0) return null;
    
    const finalContent = content.join('\n\n');
    this.injectStore.record(sessionId, finalContent, sourceIds);
    
    return {
      content: finalContent,
      sourceIds,
      tokenCount,
    };
  }

  /**
   * Build search query from recent context
   */
  private buildQuery(context: string): string | null {
    // Extract key terms - in production would use NLP
    const words = context
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    // Take first few significant words
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
