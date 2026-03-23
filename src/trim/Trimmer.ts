/**
 * Quantum Memory - Trimmer
 * 
 * Structurally lossless trimming of conversation messages.
 * Based on CMV (Contextual Memory Virtualisation) research:
 * - Paper: https://arxiv.org/abs/2602.22402  
 * - Reference: https://github.com/CosmoNaught/claude-code-cmv
 * 
 * CORE PRINCIPLE:
 * Preserve ALL user messages and assistant responses verbatim.
 * Only strip mechanical overhead: tool outputs, base64 images, metadata.
 * 
 * This achieves 20-86% token reduction while keeping conversation semantically intact.
 * If the model needs a file again, it re-reads it.
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 1
 */

import type { Message } from '../engine/MessageStore.js';
import {
  type TrimOptions,
  type TrimMetrics,
  type TrimResult,
  type TrimmedMessage,
  type TrimMessage,
  DEFAULT_TRIM_OPTIONS,
  createEmptyMetrics,
  estimateTokens,
  WRITE_TOOLS,
  PRESERVED_INPUT_FIELDS,
} from './types.js';

/**
 * Trimmer - structurally lossless message trimming
 * 
 * Usage:
 * ```typescript
 * const trimmer = new Trimmer({ stubThreshold: 500 });
 * const result = trimmer.trim(messages);
 * console.log(`Reduced by ${result.metrics.reductionPercent}%`);
 * ```
 */
export class Trimmer {
  private options: TrimOptions;

  constructor(options: Partial<TrimOptions> = {}) {
    this.options = { ...DEFAULT_TRIM_OPTIONS, ...options };
  }

  /**
   * Trim messages according to options.
   * 
   * ALGORITHM:
   * 1. Collect all tool_use IDs (for orphan detection)
   * 2. Process each message based on role:
   *    - user: strip base64 images, preserve text
   *    - assistant: strip thinking blocks, preserve text
   *    - tool: stub large results, remove orphans
   * 3. Calculate metrics
   * 
   * @param messages - Messages to trim (accepts TrimMessage interface)
   */
  trim(messages: TrimMessage[]): TrimResult {
    const metrics = createEmptyMetrics();
    const trimmed: TrimmedMessage[] = [];
    
    // Phase 1: Collect tool_use IDs for orphan detection
    // Orphan = tool_result whose tool_use_id is not in this set
    const toolUseIds = this.collectToolUseIds(messages);
    
    // Phase 2: Process each message
    for (const msg of messages) {
      metrics.totalMessages++;
      metrics.bytesBefore += Buffer.byteLength(msg.content, 'utf8');
      
      const result = this.trimMessage(msg, toolUseIds, metrics);
      trimmed.push(result);
      
      metrics.bytesAfter += Buffer.byteLength(result.content, 'utf8');
    }
    
    // Phase 3: Calculate final metrics
    this.finalizeMetrics(metrics);
    
    return { messages: trimmed, metrics, toolUseIds };
  }

  /**
   * Collect all tool_use IDs from messages
   * Used to detect orphaned tool_results
   */
  private collectToolUseIds(messages: TrimMessage[]): Set<string> {
    const ids = new Set<string>();
    
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        this.extractToolUseIds(msg.content, ids);
      }
    }
    
    return ids;
  }

  /**
   * Extract tool_use IDs from content (handles both text and JSON blocks)
   */
  private extractToolUseIds(content: string, ids: Set<string>): void {
    // Match "tool_use_id": "..." or tool_use_id: "..."
    const pattern = /"tool_use_id"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) ids.add(match[1]);
    }
    
    // Also match "id": "..." within tool_use blocks
    const idPattern = /"type"\s*:\s*"tool_use"[^}]*"id"\s*:\s*"([^"]+)"/g;
    while ((match = idPattern.exec(content)) !== null) {
      if (match[1]) ids.add(match[1]);
    }
  }

  /**
   * Trim a single message based on its role
   */
  private trimMessage(
    msg: TrimMessage, 
    toolUseIds: Set<string>, 
    metrics: TrimMetrics
  ): TrimmedMessage {
    const originalLength = msg.content.length;
    
    switch (msg.role) {
      case 'user':
        return this.trimUserMessage(msg, metrics);
        
      case 'assistant':
        return this.trimAssistantMessage(msg, toolUseIds, metrics);
        
      case 'tool':
        return this.trimToolMessage(msg, toolUseIds, metrics);
        
      default:
        // Unknown role - preserve as-is
        metrics.preserved++;
        return this.createTrimmedMessage(msg, msg.content, false);
    }
  }

  /**
   * Trim user message: strip base64 images, preserve text
   */
  private trimUserMessage(msg: TrimMessage, metrics: TrimMetrics): TrimmedMessage {
    let content = msg.content;
    
    // Strip base64 images
    if (this.options.stripBase64) {
      const stripped = this.stripBase64Images(content);
      if (stripped.modified) {
        metrics.imagesStripped += stripped.count;
        content = stripped.content;
      }
    }
    
    metrics.preserved++;
    return this.createTrimmedMessage(msg, content, content.length !== msg.content.length);
  }

  /**
   * Trim assistant message: strip thinking blocks, preserve text
   */
  private trimAssistantMessage(
    msg: TrimMessage, 
    toolUseIds: Set<string>, 
    metrics: TrimMetrics
  ): TrimmedMessage {
    let content = msg.content;
    let wasTrimmed = false;
    
    // Strip thinking blocks (non-portable signatures)
    if (this.options.stripThinkingBlocks) {
      const stripped = this.stripThinkingBlocks(content);
      if (stripped.modified) {
        metrics.thinkingBlocksStripped += stripped.count;
        content = stripped.content;
        wasTrimmed = true;
      }
    }
    
    // Strip base64 images
    if (this.options.stripBase64) {
      const stripped = this.stripBase64Images(content);
      if (stripped.modified) {
        metrics.imagesStripped += stripped.count;
        content = stripped.content;
        wasTrimmed = true;
      }
    }
    
    metrics.preserved++;
    return this.createTrimmedMessage(msg, content, wasTrimmed);
  }

  /**
   * Trim tool message: stub large results, remove orphans
   */
  private trimToolMessage(
    msg: TrimMessage, 
    toolUseIds: Set<string>, 
    metrics: TrimMetrics
  ): TrimmedMessage {
    // Check if this tool_result references a tool_use we've seen
    const toolUseId = this.extractToolUseId(msg.content);
    
    if (toolUseId && !toolUseIds.has(toolUseId)) {
      // Orphaned tool result — the tool_use was before the boundary
      metrics.orphansRemoved++;
      return this.createTrimmedMessage(msg, '[Orphaned tool result removed]', true);
    }
    
    // Stub large tool results
    if (msg.content.length > this.options.stubThreshold) {
      metrics.stubbed++;
      const stubbed = this.stubContent(msg.content);
      return this.createTrimmedMessage(msg, stubbed, true);
    }
    
    // Small tool result — preserve as-is
    metrics.preserved++;
    return this.createTrimmedMessage(msg, msg.content, false);
  }

  /**
   * Strip base64-encoded images from content
   */
  private stripBase64Images(content: string): { content: string; modified: boolean; count: number } {
    // Match data:image/...;base64,... patterns
    const pattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
    const matches = content.match(pattern) || [];
    
    if (matches.length === 0) {
      return { content, modified: false, count: 0 };
    }
    
    const newContent = content.replace(pattern, '[Image stripped]');
    return { content: newContent, modified: true, count: matches.length };
  }

  /**
   * Strip thinking/reasoning blocks from content
   * These have non-portable cryptographic signatures
   */
  private stripThinkingBlocks(content: string): { content: string; modified: boolean; count: number } {
    // Match <thinking>...</thinking> blocks
    const pattern = /<thinking>[\s\S]*?<\/thinking>/g;
    const matches = content.match(pattern) || [];
    
    if (matches.length === 0) {
      return { content, modified: false, count: 0 };
    }
    
    const newContent = content.replace(pattern, '');
    return { content: newContent, modified: true, count: matches.length };
  }

  /**
   * Extract tool_use_id from tool result content
   */
  private extractToolUseId(content: string): string | null {
    const match = content.match(/"tool_use_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }

  /**
   * Create stub placeholder for large content.
   * Preserves [QM File: ...] file references so files can still be looked up.
   */
  private stubContent(content: string): string {
    // Check for [QM File: fileId|filename|mimeType|size] pattern
    const fileMatch = content.match(/\[QM File: ([^\]|]+)\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)/);
    if (fileMatch && fileMatch[1]) {
      const fileId = fileMatch[1].trim();
      const fileName = fileMatch[2]?.trim() ?? '';
      const mimeType = fileMatch[3]?.trim() ?? '';
      const size = fileMatch[4]?.trim() ?? '';
      return `[QM File: ${fileId}|${fileName}|${mimeType}|${size}|STUB]`;
    }
    // Default stub for non-file content
    const charCount = content.length;
    const lines = content.split('\n').length;
    return `[Trimmed: ~${charCount} chars, ${lines} lines]`;
  }

  /**
   * Create TrimmedMessage from original message
   */
  private createTrimmedMessage(
    msg: TrimMessage, 
    content: string, 
    wasTrimmed: boolean
  ): TrimmedMessage {
    return {
      id: msg.id,
      role: msg.role,
      content,
      tokens: estimateTokens(content.length),
      wasTrimmed,
      originalLength: msg.content.length,
    };
  }

  /**
   * Calculate final metrics (percentages, token estimates)
   */
  private finalizeMetrics(metrics: TrimMetrics): void {
    metrics.tokenEstimateBefore = estimateTokens(metrics.bytesBefore);
    metrics.tokenEstimateAfter = estimateTokens(metrics.bytesAfter);
    
    if (metrics.bytesBefore > 0) {
      metrics.reductionPercent = 
        ((metrics.bytesBefore - metrics.bytesAfter) / metrics.bytesBefore) * 100;
    }
  }
}
