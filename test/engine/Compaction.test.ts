/**
 * KeywordCompactor & DeterministicDropper Unit Tests
 * 
 * @see src/engine/KeywordCompactor.ts
 * @see src/engine/DeterministicDropper.ts
 */

import { describe, it, expect } from 'vitest';
import { KeywordCompactor } from '../../src/engine/KeywordCompactor.js';
import { DeterministicDropper } from '../../src/engine/DeterministicDropper.js';
import type { Message } from '../../src/engine/MessageStore.js';

// Mock stores
function createMockMsgStore() {
  const messages: Message[] = [];
  const compactedIds: string[] = [];
  
  return {
    getByIds(ids: string[]): Message[] {
      return messages.filter(m => ids.includes(m.id));
    },
    getBySession(sessionId: string, options?: { includeCompacted?: boolean }): Message[] {
      let filtered = messages.filter(m => m.sessionId === sessionId);
      if (!options?.includeCompacted) {
        filtered = filtered.filter(m => !m.isCompacted);
      }
      return filtered;
    },
    markCompacted(ids: string[]): void {
      compactedIds.push(...ids);
      for (const msg of messages) {
        if (ids.includes(msg.id)) {
          msg.isCompacted = true;
        }
      }
    },
    addMessage(msg: Message): void {
      messages.push(msg);
    },
    getCompactedIds(): string[] {
      return compactedIds;
    },
  };
}

function createMockSummaryStore() {
  let summaries: any[] = [];
  let maxLevel = 0;
  
  return {
    create(sessionId: string, level: number, content: string, options?: any): any {
      const summary = {
        id: `summary_${Date.now()}`,
        sessionId,
        level,
        content,
        ...options,
      };
      summaries.push(summary);
      return summary;
    },
  getMaxLevel(sessionId: string): number {
    return maxLevel;
  },
  setMaxLevel(level: number): void {
    maxLevel = level;
  },
  };
}

describe('KeywordCompactor', () => {
  describe('compact', () => {
    it('should return not compacted when no messages', () => {
      const msgStore = createMockMsgStore();
      const summaryStore = createMockSummaryStore();
      const compactor = new KeywordCompactor(msgStore as any, summaryStore as any);
      
      const result = compactor.compact('session-1', []);
      
      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(false);
      expect(result.messagesCompacted).toBe(0);
    });

    it('should extract entities from messages', () => {
      const msgStore = createMockMsgStore();
      const summaryStore = createMockSummaryStore();
      
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Captain decided to use PostgreSQL for the database',
          tokens: 10,
          createdAt: new Date().toISOString(),
          importanceScore: 0.5,
          isCompacted: false,
        },
        {
          id: 'msg-2',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'I will implement the using Python and Docker.',
          tokens: 10,
          createdAt: new Date().toISOString(),
          importanceScore: 0.5,
          isCompacted: false,
        },
      ];
      
      messages.forEach(m => msgStore.addMessage(m));
      
      const compactor = new KeywordCompactor(msgStore as any, summaryStore as any);
      const result = compactor.compact('session-1', ['msg-1', 'msg-2']);
      
      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(true);
      expect(result.messagesCompacted).toBe(2);
      expect(result.level).toBe('keyword');
      expect(result.summary).toContain('Keyword Summary');
      expect(result.summary).toContain('Captain');  // Entity extracted
      // Note: "PostgreSQL" is part of "decided to use PostgreSQL" - decision pattern
      // Tools extracted: python, docker
    });

    it('should extract tools mentioned', () => {
      const msgStore = createMockMsgStore();
      const summaryStore = createMockSummaryStore();
      
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'We need to use Python and Docker for this project',
          tokens: 10,
          createdAt: new Date().toISOString(),
          importanceScore: 0.5,
          isCompacted: false,
        },
      ];
      
      messages.forEach(m => msgStore.addMessage(m));
      
      const compactor = new KeywordCompactor(msgStore as any, summaryStore as any);
      const result = compactor.compact('session-1', ['msg-1']);
      
      expect(result.summary.toLowerCase()).toContain('python');
      expect(result.summary.toLowerCase()).toContain('docker');
    });
  });
});

describe('DeterministicDropper', () => {
  describe('drop', () => {
    it('should return not compacted when already under target', () => {
      const msgStore = createMockMsgStore();
      const summaryStore = createMockSummaryStore();
      
      // Add small messages
      for (let i = 0; i < 5; i++) {
        msgStore.addMessage({
          id: `msg-${i}`,
          sessionId: 'session-1',
          role: 'user',
          content: 'Short message',
          tokens: 10,
          createdAt: new Date().toISOString(),
          importanceScore: 0.5,
          isCompacted: false,
        });
      }
      
      const dropper = new DeterministicDropper(msgStore as any, summaryStore as any, 2);
      const result = dropper.drop('session-1', 100);  // Target higher than current
      
      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(false);
      expect(result.reason).toContain('under target');
    });

    it('should drop oldest messages when over target', () => {
      const msgStore = createMockMsgStore();
      const summaryStore = createMockSummaryStore();
      
      // Add many messages
      for (let i = 0; i < 40; i++) {
        msgStore.addMessage({
          id: `msg-${i}`,
          sessionId: 'session-1',
          role: 'user',
          content: `Message ${i} with some content to make it longer`,
          tokens: 10,
          createdAt: new Date().toISOString(),
          importanceScore: 0.5,
          isCompacted: false,
        });
      }
      
      const dropper = new DeterministicDropper(msgStore as any, summaryStore as any, 2);
      const result = dropper.drop('session-1', 100);  // Target: 100 tokens, // Current: 400 tokens
      
      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(true);
      expect(result.level).toBe('deterministic');
      expect(result.messagesCompacted).toBeGreaterThan(0);
      expect(result.tokenReduction).toBeGreaterThan(0);
    });

    it('should protect fresh tail', () => {
      const msgStore = createMockMsgStore();
      const summaryStore = createMockSummaryStore();
      
      // Add messages
      for (let i = 0; i < 10; i++) {
        msgStore.addMessage({
          id: `msg-${i}`,
          sessionId: 'session-1',
          role: 'user',
          content: `Message ${i}`,
          tokens: 10,
          createdAt: new Date().toISOString(),
          importanceScore: 0.5,
          isCompacted: false,
        });
      }
      
      const dropper = new DeterministicDropper(msgStore as any, summaryStore as any, 3);  // Fresh tail = 3
      const result = dropper.drop('session-1', 30);  // Target: 30 tokens
      
      // With 10 messages at 10 tokens each = 100 total
      // Fresh tail = 3, so can drop 7
      // Target = 30 tokens = 3 messages
      // Should drop messages 0-6 (7 messages), keep 7-9 (3 messages)
      expect(result.ok).toBe(true);
      expect(result.messagesCompacted).toBeLessThanOrEqual(7);
    });
  });
});
