/**
 * Quantum Memory - Deterministic Dropper
 * 
 * Final fallback compaction strategy that simply drops oldest messages
 * beyond the fresh tail. Guaranteed to reduce token count.
 * 
 * Used when both LLM and keyword compaction fail or are unavailable.
 * This ensures the system ALWAYS converges.
 * 
 * Based on LCM (Lossless Context Management) research:
 * - "Culminating in a deterministic fallback that requires no LLM inference"
 * - "This guarantees convergence"
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 2.3
 */

import type { Message } from './MessageStore.js';
import type { SummaryStore } from '../dag/SummaryStore.js';
import type { CompactionLevel } from '../types/context-engine.js';
import { estimateTokens } from '../trim/types.js';

/**
 * Result of deterministic drop
 */
export interface DeterministicDropResult {
  ok: boolean;
  compacted: boolean;
  summaryId?: string;
  messagesCompacted: number;
  tokenReduction: number;
  level: CompactionLevel;
  reason?: string;
}

/**
 * DeterministicDropper - guaranteed compaction without any inference
 * 
 * Simply drops oldest messages beyond the fresh tail.
 * Creates a minimal placeholder summary to preserve DAG structure.
 */
export class DeterministicDropper {
  constructor(
    private msgStore: { 
      getBySession: (sessionId: string, options?: { includeCompacted?: boolean }) => Message[]; 
      markCompacted: (ids: string[]) => void;
    },
    private summaryStore: { 
      create: (sessionId: string, level: number, content: string, options?: any) => any; 
      getMaxLevel: (sessionId: string) => number;
    },
    private freshTailCount: number = 32,
  ) {}

  /**
   * Drop oldest messages beyond target token count.
   * Protects fresh tail (most recent messages).
   * 
   * @param sessionId - Session to compact
   * @param targetTokens - Target token count (will drop until under this)
   * @returns Drop result with minimal summary
   */
  drop(sessionId: string, targetTokens: number): DeterministicDropResult {
    // Get all uncompacted messages
    const messages = this.msgStore.getBySession(sessionId, { includeCompacted: false });
    const totalTokens = messages.reduce((sum, m) => sum + (m.tokens || estimateTokens(m.content)), 0);
    
    // Already under target
    if (totalTokens <= targetTokens) {
      return {
        ok: true,
        compacted: false,
        messagesCompacted: 0,
        tokenReduction: 0,
        level: 'deterministic',
        reason: 'Already under target',
      };
    }
    
    // Not enough messages to drop (protect fresh tail)
    if (messages.length <= this.freshTailCount) {
      return {
        ok: true,
        compacted: false,
        messagesCompacted: 0,
        tokenReduction: 0,
        level: 'deterministic',
        reason: 'Not enough messages to drop (fresh tail protection)',
      };
    }
    
    // Calculate messages to drop (from oldest, excluding fresh tail)
    const toProcess = messages.slice(0, -this.freshTailCount);
    const toDrop: string[] = [];
    let droppedTokens = 0;
    const tokensToDrop = totalTokens - targetTokens;
    
    // Drop from oldest first until we reach target
    for (const msg of toProcess) {
      if (droppedTokens >= tokensToDrop) break;
      toDrop.push(msg.id);
      droppedTokens += msg.tokens || estimateTokens(msg.content);
    }
    
    // Nothing to drop
    if (toDrop.length === 0) {
      return {
        ok: true,
        compacted: false,
        messagesCompacted: 0,
        tokenReduction: 0,
        level: 'deterministic',
        reason: 'No messages to drop',
      };
    }
    
    // Create minimal placeholder summary
    const summary = this.createMinimalSummary(toDrop.length, droppedTokens);
    
    // Create summary node in DAG
    const currentLevel = this.summaryStore.getMaxLevel(sessionId) + 1;
    const summaryNode = this.summaryStore.create(sessionId, currentLevel, summary, {
      sourceMessageIds: toDrop,
      isDeterministic: true,
    });
    
    // Mark messages as compacted
    this.msgStore.markCompacted(toDrop);
    
    console.log(`[QuantumMemory] Deterministic drop: ${toDrop.length} messages, ~${droppedTokens} tokens`);
    
    return {
      ok: true,
      compacted: true,
      summaryId: summaryNode?.id,
      messagesCompacted: toDrop.length,
      tokenReduction: droppedTokens,
      level: 'deterministic',
    };
  }

  /**
   * Create minimal placeholder summary for dropped messages
   */
  private createMinimalSummary(count: number, tokens: number): string {
    return `[Deterministic drop: ${count} messages, ~${tokens} tokens removed to reduce context size]`;
  }
}
