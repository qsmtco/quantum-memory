export interface SearchResult {
  id: string;
  sessionId: string;
  content: string;
  role: string;
  score: number;
  highlights: string[];
}

export interface SearchOptions {
  limit?: number;
  includeCompacted?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
}

/**
 * SearchEngine - full-text search across messages
 */
export class SearchEngine {
  constructor(private db: any) {}

  /**
   * Search messages by keyword with date filtering
   */
  search(sessionId: string, query: string, options?: SearchOptions): SearchResult[] {
    const limit = options?.limit ?? 20;
    const includeCompacted = options?.includeCompacted ?? false;
    
    let sql = includeCompacted
      ? `SELECT id, session_id, content, role FROM messages WHERE session_id = ? AND content LIKE ?`
      : `SELECT id, session_id, content, role FROM messages WHERE session_id = ? AND content LIKE ? AND is_compacted = 0`;
    
    const params: any[] = [sessionId, `%${query}%`];
    
    // Date range filtering (SH-004)
    if (options?.dateFrom) {
      sql += ` AND created_at >= ?`;
      params.push(options.dateFrom);
    }
    if (options?.dateTo) {
      sql += ` AND created_at <= ?`;
      params.push(options.dateTo);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    const rows = this.db.query(sql, params);
    
    return rows.map((row: any) => this.mapToSearchResult(row, query));
  }

  /**
   * Search across multiple sessions
   */
  searchGlobal(query: string, options?: {
    sessionIds?: string[];
    limit?: number;
  }): SearchResult[] {
    const limit = options?.limit ?? 20;
    
    let sql = `SELECT id, session_id, content, role FROM messages WHERE content LIKE ?`;
    const params: any[] = [`%${query}%`];
    
    if (options?.sessionIds && options.sessionIds.length > 0) {
      const placeholders = options.sessionIds.map(() => '?').join(',');
      sql += ` AND session_id IN (${placeholders})`;
      params.push(...options.sessionIds);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    const rows = this.db.query(sql, params);
    
    return rows.map((row: any) => this.mapToSearchResult(row, query));
  }

  /**
   * Search entities by name
   */
  searchEntities(sessionId: string, query: string): Array<{
    id: string;
    name: string;
    type: string;
    mentionCount: number;
  }> {
    const rows = this.db.query(
      `SELECT id, name, type, mention_count FROM entities WHERE session_id = ? AND name LIKE ? ORDER BY mention_count DESC LIMIT 10`,
      [sessionId, `%${query}%`]
    );
    
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      mentionCount: row.mention_count,
    }));
  }

  /**
   * Semantic search - find similar messages based on content similarity
   * Uses basic word overlap scoring (production would use embeddings)
   */
  semanticSearch(sessionId: string, query: string, options?: SemanticSearchOptions): SearchResult[] {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.1;
    
    const queryWords = this.tokenize(query);
    if (queryWords.length === 0) return [];
    
    const rows = this.db.query(
      `SELECT id, session_id, content, role FROM messages WHERE session_id = ? AND is_compacted = 0 ORDER BY created_at DESC LIMIT 100`,
      [sessionId]
    );
    
    // Score each message by word overlap
    const scored = rows.map((row: any) => {
      const contentWords = this.tokenize(row.content);
      const similarity = this.calculateSimilarity(queryWords, contentWords);
      return { row, similarity };
    });
    
    // Filter by threshold and sort
    const results = scored
      .filter((s: any) => s.similarity >= threshold)
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, limit);
    
    return results.map((r: any) => ({
      id: r.row.id,
      sessionId: r.row.session_id,
      content: r.row.content,
      role: r.row.role,
      score: r.similarity * 100,
      highlights: [r.row.content.slice(0, 200) + (r.row.content.length > 200 ? '...' : '')],
    }));
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Calculate Jaccard similarity between word sets
   */
  private calculateSimilarity(words1: string[], words2: string[]): number {
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    const intersection = [...set1].filter(w => set2.has(w)).length;
    const union = new Set([...set1, ...set2]).size;
    
    return intersection / union;
  }

  /**
   * Map row to search result with highlights
   */
  private mapToSearchResult(row: any, query: string): SearchResult {
    const content = row.content;
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Calculate simple score based on occurrence
    let score = 0;
    const occurrences = lowerContent.split(lowerQuery).length - 1;
    score = Math.min(occurrences / content.length * 100, 100);
    
    // Generate highlights
    const highlights = this.generateHighlights(content, query);
    
    return {
      id: row.id,
      sessionId: row.session_id,
      content,
      role: row.role,
      score,
      highlights,
    };
  }

  /**
   * Generate highlight snippets
   */
  private generateHighlights(content: string, query: string, contextChars: number = 50): string[] {
    const highlights: string[] = [];
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let pos = 0;
    
    while (highlights.length < 3) {
      const idx = lowerContent.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      
      const start = Math.max(0, idx - contextChars);
      const end = Math.min(content.length, idx + query.length + contextChars);
      
      let snippet = content.slice(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      
      highlights.push(snippet);
      pos = idx + query.length;
    }
    
    return highlights;
  }
}
