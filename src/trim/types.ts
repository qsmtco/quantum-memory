/**
 * Quantum Memory - Trimmer Types
 * 
 * Types for structurally lossless trimming of conversation messages.
 * Based on CMV (Contextual Memory Virtualisation) research:
 * - Paper: https://arxiv.org/abs/2602.22402
 * - Reference: https://github.com/CosmoNaught/claude-code-cmv
 * 
 * TRIMMING PHILOSOPHY:
 * - Preserve ALL user messages verbatim
 * - Preserve ALL assistant responses verbatim
 * - Preserve ALL tool invocations (the request metadata)
 * - Strip: base64 images, thinking signatures, file-history metadata
 * - Stub: large tool results (replace with "[Trimmed: ~N chars]")
 * - Stub: large tool inputs for write tools
 * 
 * This achieves 20-86% token reduction while keeping the conversation
 * semantically intact. If the model needs a file again, it re-reads it.
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 1
 */

/**
 * Options for trimming operation
 */
export interface TrimOptions {
  /**
   * Character threshold for stubbing tool results
   * Content longer than this gets replaced with "[Trimmed: ~N chars]"
   * Default: 500 (minimum 50)
   */
  stubThreshold: number;
  
  /**
   * Always preserve user messages (should always be true)
   * Default: true
   */
  preserveUserMessages: boolean;
  
  /**
   * Always preserve assistant responses (should always be true)
   * Default: true
   */
  preserveAssistantResponses: boolean;
  
  /**
   * Strip base64-encoded images from content
   * Images consume significant tokens and can be re-fetched if needed
   * Default: true
   */
  stripBase64: boolean;
  
  /**
   * Strip thinking/reasoning blocks
   * These have non-portable cryptographic signatures
   * Default: true
   */
  stripThinkingBlocks: boolean;
  
  /**
   * Strip file-history metadata entries
   * These are internal tracking and don't affect conversation
   * Default: true
   */
  stripFileHistory: boolean;
  
  /**
   * Strip queue operation metadata
   * Default: true
   */
  stripQueueOps: boolean;
}

/**
 * Metrics collected during trimming operation
 */
export interface TrimMetrics {
  /** Total messages processed */
  totalMessages: number;
  
  /** Messages preserved without modification */
  preserved: number;
  
  /** Messages stripped entirely (file-history, queue-ops) */
  stripped: number;
  
  /** Tool results stubbed (content replaced with placeholder) */
  stubbed: number;
  
  /** Base64 images stripped from content */
  imagesStripped: number;
  
  /** Thinking/reasoning blocks removed */
  thinkingBlocksStripped: number;
  
  /** File-history entries removed */
  fileHistoryRemoved: number;
  
  /** Queue operations removed */
  queueOpsRemoved: number;
  
  /** Orphaned tool results removed (their tool_use was before boundary) */
  orphansRemoved: number;
  
  /** Raw bytes before trimming */
  bytesBefore: number;
  
  /** Raw bytes after trimming */
  bytesAfter: number;
  
  /** Estimated tokens before trimming (~4 chars per token) */
  tokenEstimateBefore: number;
  
  /** Estimated tokens after trimming */
  tokenEstimateAfter: number;
  
  /** Percentage reduction in bytes */
  reductionPercent: number;
}

/**
 * Result of a trimming operation
 */
export interface TrimResult {
  /** Trimmed messages */
  messages: TrimmedMessage[];
  
  /** Metrics collected during trimming */
  metrics: TrimMetrics;
  
  /** IDs of tool_use blocks found (for orphan detection) */
  toolUseIds: Set<string>;
}

/**
 * Message after trimming (preserves original structure)
 */
export interface TrimmedMessage {
  /** Original message ID */
  id: string;
  
  /** Message role: user, assistant, tool, system */
  role: string;
  
  /** Trimmed content (may be stubbed or stripped) */
  content: string;
  
  /** Token count after trimming */
  tokens: number;
  
  /** Whether this message was modified during trimming */
  wasTrimmed: boolean;
  
  /** Original content length (for metrics) */
  originalLength: number;
}

/**
 * Input message for trimming (simplified interface)
 * Accepts either full Message objects or partial objects with required fields
 */
export interface TrimMessage {
  /** Message ID */
  id: string;
  
  /** Message role: user, assistant, tool, system */
  role: string;
  
  /** Message content to trim */
  content: string;
  
  /** Optional token count (for metrics) */
  tokens?: number;
}

/**
 * Tool names known to carry large file-content payloads
 * These get special handling for input stubbing
 */
export const WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

/**
 * Tool input fields that should ALWAYS be preserved (identification/metadata)
 * These are small and needed for context
 */
export const PRESERVED_INPUT_FIELDS = new Set([
  'file_path',
  'notebook_path',
  'command',
  'description',
  'pattern',
  'path',
  'url',
  'skill',
  'args',
  'replace_all',
  'edit_mode',
  'cell_type',
  'cell_id',
  'tool_use_id',
  'tool_name',
]);

/**
 * Default trimming options
 */
export const DEFAULT_TRIM_OPTIONS: TrimOptions = {
  stubThreshold: 500,
  preserveUserMessages: true,
  preserveAssistantResponses: true,
  stripBase64: true,
  stripThinkingBlocks: true,
  stripFileHistory: true,
  stripQueueOps: true,
};

/**
 * Create empty metrics object (for accumulation)
 */
export function createEmptyMetrics(): TrimMetrics {
  return {
    totalMessages: 0,
    preserved: 0,
    stripped: 0,
    stubbed: 0,
    imagesStripped: 0,
    thinkingBlocksStripped: 0,
    fileHistoryRemoved: 0,
    queueOpsRemoved: 0,
    orphansRemoved: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    tokenEstimateBefore: 0,
    tokenEstimateAfter: 0,
    reductionPercent: 0,
  };
}

/**
 * Validate trim options
 * Returns array of error messages, empty if valid
 */
export function validateTrimOptions(options: TrimOptions): string[] {
  const errors: string[] = [];
  
  if (options.stubThreshold < 50) {
    errors.push('stubThreshold must be at least 50 characters');
  }
  
  if (!options.preserveUserMessages) {
    errors.push('preserveUserMessages should always be true for structurally lossless trimming');
  }
  
  if (!options.preserveAssistantResponses) {
    errors.push('preserveAssistantResponses should always be true for structurally lossless trimming');
  }
  
  return errors;
}

/**
 * Estimate tokens from character count
 * Uses ~4 chars per token heuristic (from LCM/Volt codebase)
 * Accepts either a string or a pre-computed character count.
 */
export function estimateTokens(text: string): number;
export function estimateTokens(charCount: number): number;
export function estimateTokens(textOrCount: string | number): number {
  const chars = typeof textOrCount === 'string' ? textOrCount.length : textOrCount;
  return Math.ceil(chars / 4);
}
