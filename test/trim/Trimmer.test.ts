/**
 * Trimmer Unit Tests
 * 
 * Tests for structurally lossless trimming of conversation messages.
 * @see src/trim/Trimmer.ts
 */

import { describe, it, expect } from 'vitest';
import { Trimmer } from '../../src/trim/Trimmer.js';
import { 
  DEFAULT_TRIM_OPTIONS, 
  createEmptyMetrics, 
  validateTrimOptions,
  estimateTokens 
} from '../../src/trim/types.js';
import type { Message } from '../../src/engine/MessageStore.js';

// Helper to create test messages
function createMessage(
  role: 'user' | 'assistant' | 'tool',
  content: string,
  id: string = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
): Message {
  return {
    id,
    sessionId: 'test-session',
    role,
    content,
    tokens: estimateTokens(content.length),
    createdAt: new Date().toISOString(),
    importanceScore: 0.5,
    isCompacted: false,
  };
}

describe('Trimmer', () => {
  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const trimmer = new Trimmer();
      expect(trimmer).toBeDefined();
    });

    it('should merge custom options with defaults', () => {
      const trimmer = new Trimmer({ stubThreshold: 1000 });
      expect(trimmer).toBeDefined();
    });
  });

  describe('trim', () => {
    it('should handle empty message list', () => {
      const trimmer = new Trimmer();
      const result = trimmer.trim([]);
      
      expect(result.messages).toHaveLength(0);
      expect(result.metrics.totalMessages).toBe(0);
      expect(result.metrics.bytesBefore).toBe(0);
      expect(result.metrics.bytesAfter).toBe(0);
    });

    it('should preserve all user messages verbatim', () => {
      const trimmer = new Trimmer();
      const messages = [
        createMessage('user', 'Hello, this is a test message'),
        createMessage('user', 'Another user message'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.content).toBe('Hello, this is a test message');
      expect(result.messages[1]?.content).toBe('Another user message');
      expect(result.metrics.preserved).toBe(2);
    });

    it('should preserve all assistant responses verbatim', () => {
      const trimmer = new Trimmer();
      const messages = [
        createMessage('assistant', 'I will help you with that.'),
        createMessage('assistant', 'Here is the result.'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.content).toBe('I will help you with that.');
      expect(result.messages[1]?.content).toBe('Here is the result.');
      expect(result.metrics.preserved).toBe(2);
    });

    it('should strip base64 images from user content', () => {
      const trimmer = new Trimmer({ stripBase64: true });
      const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
      const messages = [
        createMessage('user', `Here is an image: ${base64Image}`),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[0]?.content).not.toContain('base64');
      expect(result.messages[0]?.content).toContain('[Image stripped]');
      expect(result.metrics.imagesStripped).toBe(1);
    });

    it('should strip thinking blocks from assistant content', () => {
      const trimmer = new Trimmer({ stripThinkingBlocks: true });
      const messages = [
        createMessage('assistant', 'Let me think...<thinking>internal reasoning here</thinking>Done!'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[0]?.content).not.toContain('<thinking>');
      expect(result.messages[0]?.content).toContain('Let me think...');
      expect(result.messages[0]?.content).toContain('Done!');
      expect(result.metrics.thinkingBlocksStripped).toBe(1);
    });

    it('should stub large tool results', () => {
      const trimmer = new Trimmer({ stubThreshold: 100 });
      const largeContent = 'x'.repeat(200);
      const messages = [
        // Need assistant message with tool_use to prevent orphan detection
        createMessage('assistant', '{"type": "tool_use", "id": "tool-123", "name": "read"}'),
        createMessage('tool', `{"tool_use_id": "tool-123", "content": "${largeContent}"}`),
      ];
      
      const result = trimmer.trim(messages);
      
      // First message is assistant (preserved), second is tool (stubbed)
      expect(result.messages[1]?.content).toContain('[Trimmed:');
      expect(result.metrics.stubbed).toBe(1);
    });

    it('should keep small tool results', () => {
      const trimmer = new Trimmer({ stubThreshold: 500 });
      const smallContent = 'result: 42';
      const messages = [
        // Need assistant message with tool_use to prevent orphan detection
        createMessage('assistant', '{"type": "tool_use", "id": "tool-123", "name": "read"}'),
        createMessage('tool', `{"tool_use_id": "tool-123", "content": "${smallContent}"}`),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[1]?.content).toContain(smallContent);
      expect(result.metrics.stubbed).toBe(0);
    });

    it('should remove orphaned tool results', () => {
      const trimmer = new Trimmer();
      // Tool result references tool-999 which doesn't exist in any assistant message
      const messages = [
        createMessage('tool', '{"tool_use_id": "tool-999", "content": "orphan result"}'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[0]?.content).toBe('[Orphaned tool result removed]');
      expect(result.metrics.orphansRemoved).toBe(1);
    });

    it('should keep tool results with matching tool_use_id', () => {
      const trimmer = new Trimmer();
      const messages = [
        createMessage('assistant', '{"type": "tool_use", "id": "tool-123", "name": "read"}'),
        createMessage('tool', '{"tool_use_id": "tool-123", "content": "file contents"}'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[1]?.content).toContain('file contents');
      expect(result.metrics.orphansRemoved).toBe(0);
    });

    it('should calculate correct metrics', () => {
      const trimmer = new Trimmer();
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi there'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.metrics.totalMessages).toBe(2);
      expect(result.metrics.preserved).toBe(2);
      expect(result.metrics.bytesBefore).toBeGreaterThan(0);
      expect(result.metrics.bytesAfter).toBeGreaterThan(0);
      expect(result.metrics.reductionPercent).toBeGreaterThanOrEqual(0);
    });

    it('should handle messages with no trimmable content', () => {
      const trimmer = new Trimmer();
      const messages = [
        createMessage('user', 'Plain text message'),
        createMessage('assistant', 'Plain text response'),
      ];
      
      const result = trimmer.trim(messages);
      
      // Should have no reduction since nothing was trimmed
      expect(result.metrics.reductionPercent).toBe(0);
      expect(result.metrics.imagesStripped).toBe(0);
      expect(result.metrics.thinkingBlocksStripped).toBe(0);
      expect(result.metrics.stubbed).toBe(0);
    });
  });

  describe('trim with different options', () => {
    it('should respect stripBase64: false', () => {
      const trimmer = new Trimmer({ stripBase64: false });
      const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
      const messages = [
        createMessage('user', `Image: ${base64Image}`),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[0]?.content).toContain('base64');
      expect(result.metrics.imagesStripped).toBe(0);
    });

    it('should respect stripThinkingBlocks: false', () => {
      const trimmer = new Trimmer({ stripThinkingBlocks: false });
      const messages = [
        createMessage('assistant', 'Think<thinking>reasoning</thinking>Done'),
      ];
      
      const result = trimmer.trim(messages);
      
      expect(result.messages[0]?.content).toContain('<thinking>');
      expect(result.metrics.thinkingBlocksStripped).toBe(0);
    });

    it('should respect custom stubThreshold', () => {
      const trimmer = new Trimmer({ stubThreshold: 10 });
      const content = 'This is a 30 character string'; // 30 chars
      const messages = [
        // Need assistant message with tool_use to prevent orphan detection
        createMessage('assistant', '{"type": "tool_use", "id": "t1", "name": "read"}'),
        createMessage('tool', `{"tool_use_id": "t1", "content": "${content}"}`),
      ];
      
      const result = trimmer.trim(messages);
      
      // Should be stubbed since 30 > 10
      expect(result.messages[1]?.content).toContain('[Trimmed:');
    });
  });
});

describe('types', () => {
  describe('createEmptyMetrics', () => {
    it('should create metrics with all zeros', () => {
      const metrics = createEmptyMetrics();
      
      expect(metrics.totalMessages).toBe(0);
      expect(metrics.preserved).toBe(0);
      expect(metrics.stripped).toBe(0);
      expect(metrics.stubbed).toBe(0);
      expect(metrics.bytesBefore).toBe(0);
      expect(metrics.bytesAfter).toBe(0);
      expect(metrics.reductionPercent).toBe(0);
    });
  });

  describe('validateTrimOptions', () => {
    it('should pass valid options', () => {
      const errors = validateTrimOptions(DEFAULT_TRIM_OPTIONS);
      expect(errors).toHaveLength(0);
    });

    it('should fail on low stubThreshold', () => {
      const errors = validateTrimOptions({
        ...DEFAULT_TRIM_OPTIONS,
        stubThreshold: 10,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('stubThreshold');
    });

    it('should warn on preserveUserMessages: false', () => {
      const errors = validateTrimOptions({
        ...DEFAULT_TRIM_OPTIONS,
        preserveUserMessages: false,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('preserveUserMessages');
    });

    it('should warn on preserveAssistantResponses: false', () => {
      const errors = validateTrimOptions({
        ...DEFAULT_TRIM_OPTIONS,
        preserveAssistantResponses: false,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('preserveAssistantResponses');
    });
  });

  describe('estimateTokens', () => {
    it('should estimate ~4 chars per token', () => {
      expect(estimateTokens(100)).toBe(25);
      expect(estimateTokens(400)).toBe(100);
      expect(estimateTokens(1)).toBe(1); // Ceiling
    });
  });
});
