import { MessageStore } from './MessageStore.js';
import { SessionManager } from './SessionManager.js';
import { SummaryStore } from '../dag/SummaryStore.js';
import { QuantumConfig } from '../utils/config.js';

export interface ContextItem {
  type: 'message' | 'summary';
  role?: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens: number;
}

export interface GetContextOptions {
  maxTokens?: number;
  includeSummaries?: boolean;
}

export interface ContextResult {
  items: ContextItem[];
  totalTokens: number;
  truncated: boolean;
}

/**
 * ContextStore - handles context retrieval and assembly
 */
export class ContextStore {
  constructor(
    private messageStore: MessageStore,
    private sessionManager: SessionManager,
    private summaryStore: SummaryStore,
    private freshTailCount: number = 32,
    private contextWindow: number = 32000
  ) {}

  /**
   * Get context for a session
   * Combines summaries + fresh tail up to token budget
   * Context assembled oldest -> newest for model context
   */
  getContext(sessionId: string, options: GetContextOptions = {}): ContextResult {
    const maxTokens = options.maxTokens ?? 8000;
    const includeSummaries = options.includeSummaries ?? true;
    
    // Get session to verify it exists
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    const items: ContextItem[] = [];
    let totalTokens = 0;
    let truncated = false;
    
    // 1. Get summaries first (oldest context)
    if (includeSummaries && !truncated) {
      const summaries = this.getSummariesOrdered(sessionId);
      for (const summary of summaries) {
        if (totalTokens + summary.tokens > maxTokens) {
          truncated = true;
          break;
        }
        items.push({
          type: 'summary',
          content: summary.content,
          tokens: summary.tokens,
        });
        totalTokens += summary.tokens;
      }
    }
    
    // 2. Get fresh tail (most recent context)
    const freshTail = this.messageStore.getFreshTail(sessionId, this.freshTailCount);
    
    for (const msg of freshTail) {
      if (totalTokens + msg.tokens > maxTokens) {
        truncated = true;
        break;
      }
      items.push({
        type: 'message',
        role: msg.role,
        content: msg.content,
        tokens: msg.tokens,
      });
      totalTokens += msg.tokens;
    }
    
    return {
      items,
      totalTokens,
      truncated,
    };
  }

  /**
   * Get summaries ordered oldest -> newest (for context assembly)
   */
  private getSummariesOrdered(sessionId: string): Array<{ content: string; tokens: number }> {
    const summaries = this.summaryStore.getBySession(sessionId);
    
    // Group by level and get latest at each level
    const latestByLevel = this.summaryStore.getLatestByLevel(sessionId);
    
    // Return in order: lower levels first (older), then higher levels
    return latestByLevel
      .sort((a, b) => a.level - b.level)
      .map(s => ({ content: s.content, tokens: s.tokens }));
  }

  /**
   * Get current token count (messages + summaries)
   */
  getTokenCount(sessionId: string): number {
    const msgTokens = this.messageStore.getTotalTokens(sessionId);
    const summaryTokens = this.summaryStore.getTotalTokens(sessionId);
    return msgTokens + summaryTokens;
  }

  /**
   * Check if context needs compaction
   */
  needsCompaction(sessionId: string, threshold: number = 0.75): boolean {
    const totalTokens = this.getTokenCount(sessionId);
    return totalTokens > this.contextWindow * threshold;
  }

  /**
   * Get DAG depth
   */
  getDagDepth(sessionId: string): number {
    return this.summaryStore.getMaxLevel(sessionId);
  }
}
