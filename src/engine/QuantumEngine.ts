import type { 
  ContextEngine, 
  ContextEngineInfo, 
  AssembleResult, 
  BootstrapResult, 
  CompactResult, 
  IngestBatchResult, 
  IngestResult, 
  SubagentEndReason, 
  SubagentSpawnPreparation, 
  AgentMessage 
} from '../types/context-engine.js';
import { resolveQuantumConfig, type QuantumConfig } from '../utils/config.js';
import { getDatabase, closeDatabase } from '../db/Database.js';
import { SessionManager } from '../engine/SessionManager.js';
import { MessageStore } from '../engine/MessageStore.js';
import { SummaryStore } from '../dag/SummaryStore.js';
import { EntityStore } from '../entities/EntityStore.js';
import { RelationStore } from '../entities/RelationStore.js';
import { SearchEngine } from '../search/SearchEngine.js';
import { MemoryInjectStore } from '../recall/MemoryInjectStore.js';
import { AutoRecallInjector } from '../recall/AutoRecallInjector.js';
import { SmartDropper } from '../drop/SmartDropper.js';
import { ContextStore } from '../engine/ContextStore.js';
import { ProjectManager } from '../projects/ProjectManager.js';
import { LargeFileStore } from './LargeFileStore.js';
import { extractEntities, estimateTokens } from '../utils/EntityExtractor.js';
import { LLMCaller } from '../utils/LLMCaller.js';
import { compileSessionPatterns, matchesSessionPattern } from '../utils/session-patterns.js';
import { Trimmer } from '../trim/Trimmer.js';
import { KeywordCompactor } from './KeywordCompactor.js';
import { DeterministicDropper } from './DeterministicDropper.js';
import { LineageTraverser } from '../dag/LineageTraverser.js';
import { validateSessionId, validateMessageContent, assertNonEmptyArray } from '../utils/validators.js';

/**
 * Extract text content from an AgentMessage, handling various message types
 * AgentMessage can be UserMessage, AssistantMessage, ToolMessage, etc.
 * Not all have a simple .content string property
 */
function extractMessageContent(msg: AgentMessage): string {
  // Handle messages with direct string content
  if (typeof (msg as any).content === 'string') {
    return (msg as any).content;
  }
  // Handle messages with parts/content array
  const parts = (msg as any).parts;
  if (Array.isArray(parts)) {
    return parts.map((p: any) => p.text || p.content || '').join('');
  }
  // Handle tool messages with output
  if ((msg as any).output) {
    return typeof (msg as any).output === 'string' 
      ? (msg as any).output 
      : JSON.stringify((msg as any).output);
  }
  // Fallback: stringify entire message
  return JSON.stringify(msg);
}

/**
 * QuantumContextEngine - Context Engine for OpenClaw
 * 
 * Implements the ContextEngine interface for managing session context
 * with DAG-based compaction, entity extraction, and auto-recall.
 * 
 * Key features:
 * - Stores all messages in SQLite for persistence
 * - Extracts entities (persons, projects, tools) from messages
 * - Builds knowledge graph from entity relations
 * - DAG-based compaction for long conversations
 * - Auto-recall to inject relevant memories before responses
 * 
 * @example
 * // Register with OpenClaw:
 * registerQuantumMemory({ registerContextEngine: (id, factory) => { ... } })
 */
export class QuantumContextEngine implements ContextEngine {
  
  readonly info: ContextEngineInfo = {
    id: 'quantum-memory',
    name: 'Quantum Memory',
    version: '2.0.0',
    ownsCompaction: true,
  };

  constructor(openclawConfig?: any) {
    // Load config from openclaw plugin config, with defaults
    this._config = resolveQuantumConfig(openclawConfig ?? {});
    this.freshTailCount = this._config.freshTailCount;
    this.contextThreshold = this._config.contextThreshold;
    this.contextWindow = this._config.contextWindow;
    this.dropThreshold = this._config.dropThreshold;
    this.maxRecallTokens = this._config.maxRecallTokens;
    this.trimStubThreshold = this._config.trimmer.trimStubThreshold;
    this.trimStripBase64 = this._config.trimmer.trimStripBase64;
    this.trimStripThinkingBlocks = this._config.trimmer.trimStripThinkingBlocks;
  }

  // Core stores - initialized lazily
  private _db: any = null;
  private _sessionMgr: SessionManager | null = null;
  private _msgStore: MessageStore | null = null;
  private _summaryStore: SummaryStore | null = null;
  private _entityStore: EntityStore | null = null;
  private _relationStore: RelationStore | null = null;
  private _searchEngine: SearchEngine | null = null;
  private _injectStore: MemoryInjectStore | null = null;
  private _injector: AutoRecallInjector | null = null;
  private _dropper: SmartDropper | null = null;
  private _ctxStore: ContextStore | null = null;
  private _projectManager: ProjectManager | null = null;
  private _largeFileStore: LargeFileStore | null = null;
  private _trimmer: Trimmer | null = null;
  private _lineageTraverser: LineageTraverser | null = null;

  // LLM caller for summarization
  private _llmCaller: LLMCaller | null = null;
  private _tools: Record<string, any> | null = null;

  // Public accessors for tools and external use
  getCurrentSessionId(): string { return this._currentSessionId ?? ""; }
  get searchEngine() { return this._searchEngine; }
  get entityStore() { return this._entityStore; }
  get relationStore() { return this._relationStore; }
  get messageStore() { return this.getMessageStore(); }  // Phase 3.3: For LineageTraverser
  get summaryStore() { return this.getSummaryStore(); }  // Phase 3.3: For LineageTraverser
  get lineageTraverser() { return this.getLineageTraverser(); }  // Phase 4: For AutoRecallInjector + qm_lineage tool
  get memoryInjectStore() { return this._injectStore; }
  get sessionManager() { return this._sessionMgr; }
  get sessionStore() { return this._sessionMgr; }  // Alias for sessionManager
  get projectManager() { return this.getProjectManager(); }
  private _currentSessionId: string | null = null;

  // Configuration — loaded from QuantumConfig, defaults in config.ts
  private _config: QuantumConfig;
  private freshTailCount: number;
  private contextThreshold: number;
  private contextWindow: number;
  private dropThreshold: number;
  private maxRecallTokens: number;
  private trimStubThreshold: number;
  private trimStripBase64: boolean;
  private trimStripThinkingBlocks: boolean;
  
  // Session pattern matching
  private ignoreSessionPatterns: RegExp[] = [];
  private statelessSessionPatterns: RegExp[] = [];
  private skipStatelessSessions = true;

  /**
   * Set session patterns from config
   */
  setSessionPatterns(config: {
    ignoreSessionPatterns?: string[];
    statelessSessionPatterns?: string[];
    skipStatelessSessions?: boolean;
  }): void {
    this.ignoreSessionPatterns = compileSessionPatterns(config.ignoreSessionPatterns || []);
    this.statelessSessionPatterns = compileSessionPatterns(config.statelessSessionPatterns || []);
    this.skipStatelessSessions = config.skipStatelessSessions ?? true;
    
    if (this.ignoreSessionPatterns.length > 0) {
      console.log(`[QuantumMemory] Ignoring sessions matching ${this.ignoreSessionPatterns.length} pattern(s)`);
    }
    if (this.skipStatelessSessions && this.statelessSessionPatterns.length > 0) {
      console.log(`[QuantumMemory] Stateless session patterns: ${this.statelessSessionPatterns.length} pattern(s)`);
    }
  }

  /**
   * Check if session should be ignored entirely (no read, no write)
   */
  isIgnoredSession(sessionKey: string | undefined): boolean {
    const candidate = sessionKey?.trim() || '';
    if (!candidate || this.ignoreSessionPatterns.length === 0) {
      return false;
    }
    return matchesSessionPattern(candidate, this.ignoreSessionPatterns);
  }

  /**
   * Check if session is stateless (can read but not write)
   */
  isStatelessSession(sessionKey: string | undefined): boolean {
    const candidate = sessionKey?.trim() || '';
    if (!this.skipStatelessSessions || !candidate || this.statelessSessionPatterns.length === 0) {
      return false;
    }
    return matchesSessionPattern(candidate, this.statelessSessionPatterns);
  }

  /**
   * Initialize engine state for a session
   * 
   * Creates a session record in the database if it doesn't exist.
   * Initializes all core stores for this session.
   */
  async bootstrap(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
  }): Promise<BootstrapResult> {
    validateSessionId(params.sessionId);
    console.log('[QuantumMemory] Bootstrap:', params.sessionId);

    // Get database connection
    const db = this.getDb();
    
    // Create session record
    db.run(
      `INSERT OR IGNORE INTO sessions (id, status) VALUES (?, 'active')`,
      [params.sessionId]
    );
    
    return {
      bootstrapped: true,
    };
  }

  /**
   * Set LLM tools from OpenClaw context
   * 
   * Must be called by OpenClaw after plugin registration to enable LLM features.
   * @param tools - OpenClaw tools object from context
   */
  /**
   * Set LLM tools and config from OpenClaw context
   * 
   * @param tools - OpenClaw tools object from context
   * @param config - Optional config for model/provider overrides
   */
  setTools(tools: Record<string, any>, config?: {
    summaryModel?: string;
    summaryProvider?: string;
    expansionModel?: string;
    expansionProvider?: string;
  }): void {
    this._tools = tools;
    this._llmCaller = new LLMCaller(tools, config);
    console.log('[QuantumMemory] LLM tools configured:', this._llmCaller.getToolName() || 'none');
  }

  /**
   * Check if LLM is available for summarization
   */
  isLLMAvailable(): boolean {
    return this._llmCaller?.isAvailable() ?? false;
  }

  /**
   * Look up a large file by its file ID.
   * Returns file metadata and summary, or null if not found.
   * 
   * Use this to expand [QM File: ...|STUB] references in trimmed messages.
   */
  async getFile(fileId: string): Promise<{
    fileId: string;
    fileName?: string;
    mimeType?: string;
    byteSize: number;
    tokenCount: number;
    summary: string;
  } | null> {
    const store = this.getLargeFileStore();
    const record = await store.getFile(fileId);
    if (!record) return null;
    return {
      fileId: record.fileId,
      fileName: record.fileName,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      tokenCount: record.tokenCount,
      summary: record.summary,
    };
  }

  /**
   * Ingest a single message into the store
   * 
   * Stores the message and extracts entities from it.
   */
  async ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    const batchResult = await this.ingestBatch({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      messages: [params.message],
      isHeartbeat: params.isHeartbeat,
    });
    return { ingested: batchResult.ingestedCount > 0 };
  }

  /**
   * Ingest a completed turn batch
   * 
   * Stores all messages and extracts entities + relations from them.
   * This is the main entry point for message persistence.
   * 
   * Flow:
   * 1. Store messages in MessageStore
   * 2. Extract entities from each message text
   * 3. Store entities in EntityStore
   * 4. Extract relations between entities
   * 5. Store relations in RelationStore
   */
  async ingestBatch(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult> {
    validateSessionId(params.sessionId);
    assertNonEmptyArray(params.messages, 'messages');

    // Validate all message contents early
    for (let i = 0; i < params.messages.length; i++) {
      const content = (params.messages[i] as any).content;
      if (content !== undefined) {
        validateMessageContent(content);
      }
    }

    // Check if session should be ignored entirely
    if (this.isIgnoredSession(params.sessionKey)) {
      console.log('[QuantumMemory] Skipping ignored session:', params.sessionKey);
      return { ingestedCount: 0 };
    }
    
    // Check if session is stateless (read-only)
    const isStateless = this.isStatelessSession(params.sessionKey);
    if (isStateless) {
      console.log('[QuantumMemory] Stateless session (read-only):', params.sessionKey);
      // Still allow reads, but skip writes - return empty
      return { ingestedCount: 0 };
    }
    
    const db = this.getDb();
    const msgStore = this.getMessageStore();
    const entityStore = this.getEntityStore();
    const relationStore = this.getRelationStore();

    // Skip heartbeats for entity extraction (not worth the overhead)
    if (params.isHeartbeat) {
      const stored = msgStore.createBatch(
        params.sessionId,
        params.messages.map(m => ({ role: m.role, content: extractMessageContent(m) }))
      );
      return { ingestedCount: stored.length };
    }

    // Process each message - extract content as string (AgentMessage content can be complex)
    const stored = msgStore.createBatch(
      params.sessionId,
      params.messages.map(m => ({ 
        role: m.role, 
        content: extractMessageContent(m) 
      }))
    );

    // Detect and track large file references in message content
    // Uses LLM summarization if available (via getLargeFileStore summarizer)
    const largeFileStore = this.getLargeFileStore();
    for (const msg of params.messages) {
      const text = extractMessageContent(msg);
      await largeFileStore.processMessage(params.sessionId, text);
    }

    // Extract and store entities from each message
    for (let i = 0; i < params.messages.length; i++) {
      const msg = params.messages[i];
      if (!msg) continue;
      // Handle complex content types - extract string content
      const text = extractMessageContent(msg);
      
      // Skip very short messages
      if (text.length < 10) continue;

      // Extract entities using pattern matching
      const extraction = extractEntities(text);
      
      // Store entities with session context
      for (const ent of extraction.entities) {
        entityStore.upsert(params.sessionId, ent.name, ent.type, {
          confidence: ent.confidence,
          sourceMessageId: stored[i]?.id,
        });
      }

      // Store relations between entities
      for (const rel of extraction.relations) {
        // Look up entity IDs by name
        const fromEntity = entityStore.findByName(params.sessionId, rel.from, 'person') 
          || entityStore.findByName(params.sessionId, rel.from, 'project')
          || entityStore.findByName(params.sessionId, rel.from, 'tool')
          || entityStore.findByName(params.sessionId, rel.from, 'concept');
          
        const toEntity = entityStore.findByName(params.sessionId, rel.to, 'person')
          || entityStore.findByName(params.sessionId, rel.to, 'project')
          || entityStore.findByName(params.sessionId, rel.to, 'tool')
          || entityStore.findByName(params.sessionId, rel.to, 'concept');

        if (fromEntity && toEntity && fromEntity.id !== toEntity.id) {
          relationStore.create(
            params.sessionId,
            fromEntity.id,
            toEntity.id,
            rel.type,
            { sourceMessageId: stored[i]?.id }
          );
        }
      }
    }

    console.log(`[QuantumMemory] Ingested ${stored.length} messages, extracted entities`);
    return { ingestedCount: stored.length };
  }

  /**
   * Post-turn lifecycle work
   * 
   * Called after each agent turn. Can trigger compaction if needed.
   */
  async afterTurn(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
  }): Promise<void> {
    // Skip heavy processing for heartbeat runs
    if (params.isHeartbeat) return;

    // Smart drop: mark low-importance messages as compacted before compaction runs
    // Drop threshold from config: messages with importance_score < threshold get dropped
    // Uses LLM scoring if available, keyword fallback otherwise
    const dropper = this.getDropper();
    const dropResult = await dropper.drop(params.sessionId, this.dropThreshold, false);
    if (dropResult.dropped > 0) {
      console.log(`[QuantumMemory] Smart drop: ${dropResult.dropped} messages dropped (reason: ${dropResult.records[0]?.reason ?? 'n/a'})`);
    }

    // Auto-compact if over threshold
    const ctxStore = this.getContextStore();
    const needsCompaction = ctxStore.needsCompaction(
      params.sessionId,
      this.contextThreshold
    );

    if (needsCompaction) {
      await this.compact({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        tokenBudget: params.tokenBudget,
        currentTokenCount: ctxStore.getTokenCount(params.sessionId),
        compactionTarget: 'threshold',
      });
    }
  }

  /**
   * Assemble model context under token budget
   * 
   * Combines:
   * 1. Summaries from DAG (older context)
   * 2. Fresh tail (recent messages)
   * 3. Auto-recalled memories (relevant past context)
   */
  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    const ctxStore = this.getContextStore();
    const budget = params.tokenBudget ?? 8000;

    // Get context from database (summaries + fresh tail)
    const contextResult = ctxStore.getContext(params.sessionId, {
      maxTokens: budget,
      includeSummaries: true,
    });

    // Build messages for the model - use any[] to avoid complex AgentMessage union type issues
    const assembled: any[] = [];

    // Add summaries first (older context)
    for (const item of contextResult.items.filter(i => i.type === 'summary')) {
      assembled.push({
        role: 'system' as any,
        content: `[Earlier Context]\n${typeof item.content === 'string' ? item.content : JSON.stringify(item.content)}`,
      });
    }

    // Add fresh messages
    for (const item of contextResult.items.filter(i => i.type === 'message')) {
      assembled.push({
        role: item.role as any,
        content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
      });
    }

    // Auto-recall: inject relevant memories from past
    // Uses getter to ensure lazy initialization (getInjector creates the instance)
    let injectionUsed = false;
    const injector = this.getInjector();
    if (injector) {
      const recentContent = params.messages.slice(-3).map(m => extractMessageContent(m)).join(' ');
      
      const injection = injector.inject(params.sessionId, recentContent, {
        maxTokens: Math.floor(budget * 0.1), // Use 10% for memories
      });

      if (injection) {
        assembled.unshift({
          role: 'system' as any,
          content: `[Relevant Past Context]\n${injection.content}`,
        });
        injectionUsed = true;
      }
    }

    // Calculate total tokens
    const totalTokens = assembled.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);

    return {
      messages: assembled,
      estimatedTokens: totalTokens,
      systemPromptAddition: injectionUsed ? 'Using auto-recalled memories.' : undefined,
    };
  }

  /**
   * Compact context to reduce token usage
   * 
   * Creates a summary of older messages using the LLM, then marks
   * those messages as compacted. This enables unlimited conversation
   * history within token budgets.
   * 
   * Algorithm:
   * 1. Get messages beyond fresh tail
   * 2. Group into chunks suitable for summarization
   * 3. Call LLM to create summary
   * 4. Store summary in DAG
   * 5. Mark original messages as compacted
   */
  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: 'budget' | 'threshold';
    customInstructions?: string;
  }): Promise<CompactResult> {
    console.log('[QuantumMemory] Compact:', params.sessionId, params.force ? '(forced)' : '');
    
    const ctxStore = this.getContextStore();
    const summaryStore = this.getSummaryStore();
    const msgStore = this.getMessageStore();

    // Calculate current token count if not provided
    const currentTokens = params.currentTokenCount ?? ctxStore.getTokenCount(params.sessionId);
    const budget = params.tokenBudget ?? 8000;
    const threshold = budget * (params.compactionTarget === 'budget' ? 1.0 : this.contextThreshold);

    // Check if compaction needed
    if (!params.force && currentTokens <= threshold) {
      return {
        ok: true,
        compacted: false,
        reason: 'under threshold',
      };
    }

    // Get messages to summarize (exclude fresh tail)
    const toSummarize = summaryStore.getMessagesToSummarize(params.sessionId, this.freshTailCount);
    
    if (toSummarize.length === 0) {
      return {
        ok: true,
        compacted: false,
        reason: 'no messages to summarize',
      };
    }

    // Phase 0.3: Log LLM status at compaction time for diagnostics
    console.log('[QuantumMemory] Compact: LLM available:', this._llmCaller?.isAvailable() ?? false);
    console.log('[QuantumMemory] Compact: LLM tool:', this._llmCaller?.getToolName() ?? '(none)');
    console.log('[QuantumMemory] Compact: Messages to summarize:', toSummarize.length);

    // Phase 2.4: Three-level escalation: LLM → keyword → deterministic
    const minTokenReduction = 100;  // Minimum reduction to consider successful
    
    // Level 1: LLM summarization (highest quality)
    if (this._llmCaller?.isAvailable()) {
      try {
        const result = await this.llmCompaction(params, toSummarize, currentTokens, summaryStore, msgStore, ctxStore);
        if (result.ok && result.compacted && (result.tokenReduction ?? 0) >= minTokenReduction) {
          result.level = 'llm';
          console.log(`[QuantumMemory] Compaction succeeded at level 'llm': ${result.messagesCompacted} messages, ${result.tokenReduction} tokens reduced`);
          return result;
        }
        console.warn(`[QuantumMemory] LLM compaction insufficient or failed, escalating...`);
      } catch (error) {
        console.error('[QuantumMemory] LLM compaction error:', error);
      }
    } else {
      console.warn('[QuantumMemory] LLM not available for compaction — using keyword extraction fallback (lower quality summaries)');
    }
    
    // Level 2: Keyword-based compaction (no LLM needed)
    try {
      const result = this.keywordCompaction(params.sessionId, toSummarize, currentTokens, summaryStore, msgStore);
      if (result.ok && result.compacted && (result.tokenReduction ?? 0) >= minTokenReduction) {
        result.level = 'keyword';
        console.log(`[QuantumMemory] Compaction succeeded at level 'keyword': ${result.messagesCompacted} messages, ${result.tokenReduction} tokens reduced`);
        return result;
      }
      console.warn(`[QuantumMemory] Keyword compaction insufficient, escalating to deterministic drop (no LLM, no keywords — just removal)`);
    } catch (error) {
      console.error('[QuantumMemory] Keyword compaction error:', error);
    }
    
    // Level 3: Deterministic drop (guaranteed convergence)
    console.warn('[QuantumMemory] Using deterministic drop — oldest messages will be removed without summarization');
    try {
      const result = this.deterministicDrop(params.sessionId, currentTokens, threshold, summaryStore, msgStore);
      result.level = 'deterministic';
      if (result.compacted) {
        console.log(`[QuantumMemory] Compaction succeeded at level 'deterministic': ${result.messagesCompacted} messages, ${result.tokenReduction} tokens reduced`);
      }
      return result;
    } catch (error) {
      console.error('[QuantumMemory] Deterministic drop error:', error);
      return {
        ok: false,
        compacted: false,
        reason: `All compaction levels failed: ${error}`,
      };
    }
  }

  /**
   * Level 1: LLM-based summarization
   * Phase 2.4: Extracted from original compact() for escalation pattern
   */
  private async llmCompaction(
    params: any,
    toSummarize: any[],
    currentTokens: number,
    summaryStore: SummaryStore,
    msgStore: MessageStore,
    ctxStore: ContextStore
  ): Promise<CompactResult> {
    // Phase 1.4: Trim messages before summarization
    const trimmer = this.getTrimmer();
    const trimResult = trimmer.trim(toSummarize as any[]);
    
    if (trimResult.metrics.reductionPercent > 0) {
      console.log(`[QuantumMemory] Trimmed ${trimResult.metrics.reductionPercent.toFixed(1)}%: ` +
        `${trimResult.metrics.tokenEstimateBefore} → ${trimResult.metrics.tokenEstimateAfter} tokens`);
    }
    
    const content = trimResult.messages.map(m => m.content).join('\n\n---\n\n');
    const currentLevel = summaryStore.getMaxLevel(params.sessionId) + 1;

    const summaryPrompt = params.customInstructions 
      ? `${params.customInstructions}\n\nSummarize this conversation:\n\n${content}`
      : `Summarize this conversation concisely while preserving:
- Key decisions and conclusions
- Important names, projects, and tools
- Technical details needed to continue
- Any errors or issues encountered

Conversation:
${content}`;

    const summaryResponse = await this._llmCaller!.generate(
      summaryPrompt,
      'You are a helpful assistant that creates concise summaries.',
      { maxTokens: 1000 }
    );

    const summaryText = summaryResponse.content;

    summaryStore.create(params.sessionId, currentLevel, summaryText, {
      sourceMessageIds: toSummarize.map((m: any) => m.id),
      modelUsed: summaryResponse.model,
    });

    msgStore.markCompacted(toSummarize.map((m: any) => m.id));

    const newTokens = ctxStore.getTokenCount(params.sessionId);

    return {
      ok: true,
      compacted: true,
      level: 'llm',
      messagesCompacted: toSummarize.length,
      tokenReduction: currentTokens - newTokens,
      result: {
        summary: summaryText,
        tokensBefore: currentTokens,
        tokensAfter: newTokens,
      },
    };
  }

  /**
   * Level 2: Keyword-based compaction (no LLM needed)
   * Phase 2.4: Fallback when LLM unavailable or failed
   */
  private keywordCompaction(
    sessionId: string,
    toSummarize: any[],
    currentTokens: number,
    summaryStore: SummaryStore,
    msgStore: MessageStore
  ): CompactResult {
    const compactor = new KeywordCompactor(msgStore, summaryStore);
    const result = compactor.compact(sessionId, toSummarize.map((m: any) => m.id));
    
    return {
      ok: result.ok,
      compacted: result.compacted,
      summaryId: result.summaryId,
      messagesCompacted: result.messagesCompacted,
      tokenReduction: result.tokenReduction,
      level: 'keyword',
      reason: result.compacted ? undefined : 'Keyword compaction produced no reduction',
      result: {
        summary: result.summary,
        tokensBefore: currentTokens,
        tokensAfter: currentTokens - result.tokenReduction,
      },
    };
  }

  /**
   * Level 3: Deterministic drop (guaranteed convergence)
   * Phase 2.4: Final fallback when all else fails
   */
  private deterministicDrop(
    sessionId: string,
    currentTokens: number,
    targetTokens: number,
    summaryStore: SummaryStore,
    msgStore: MessageStore
  ): CompactResult {
    const dropper = new DeterministicDropper(msgStore, summaryStore, this.freshTailCount);
    const result = dropper.drop(sessionId, targetTokens);
    
    return {
      ok: result.ok,
      compacted: result.compacted,
      summaryId: result.summaryId,
      messagesCompacted: result.messagesCompacted,
      tokenReduction: result.tokenReduction,
      level: 'deterministic',
      reason: result.reason,
      result: {
        tokensBefore: currentTokens,
        tokensAfter: currentTokens - result.tokenReduction,
      },
    };
  }

  /**
   * Prepare subagent state before spawn
   * 
   * Transfers relevant context to child session.
   */
  async prepareSubagentSpawn(params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined> {
    // For now, child starts fresh
    // Could transfer entity knowledge in future
    return undefined;
  }

  /**
   * Notify when subagent lifecycle ended
   * 
   * Could merge results back to parent session.
   */
  async onSubagentEnded(params: {
    childSessionKey: string;
    reason: SubagentEndReason;
  }): Promise<void> {
    console.log(`[QuantumMemory] Subagent ended: ${params.childSessionKey}, reason: ${params.reason}`);
  }

  /**
   * Dispose of engine resources
   */
  async dispose(): Promise<void> {
    console.log('[QuantumMemory] Disposing');

    // Reset all lazy stores so they are recreated fresh on next use
    this._msgStore = null;
    this._summaryStore = null;
    this._entityStore = null;
    this._relationStore = null;
    this._searchEngine = null;
    this._injectStore = null;
    this._injector = null;
    this._dropper = null;
    this._ctxStore = null;
    this._largeFileStore = null;
    this._trimmer = null;
    this._lineageTraverser = null;

    closeDatabase();
  }

  // ==================== PRIVATE HELPERS ====================

  private getDb() {
    if (!this._db) {
      this._db = getDatabase();
    }
    return this._db;
  }

  private getSessionManager(): SessionManager {
    if (!this._sessionMgr) {
      this._sessionMgr = new SessionManager(this.getDb());
    }
    return this._sessionMgr;
  }

  private getMessageStore(): MessageStore {
    if (!this._msgStore) {
      this._msgStore = new MessageStore(this.getDb());
    }
    return this._msgStore;
  }

  private getSummaryStore(): SummaryStore {
    if (!this._summaryStore) {
      this._summaryStore = new SummaryStore(this.getDb());
    }
    return this._summaryStore;
  }

  private getEntityStore(): EntityStore {
    if (!this._entityStore) {
      this._entityStore = new EntityStore(this.getDb());
    }
    return this._entityStore;
  }

  private getRelationStore(): RelationStore {
    if (!this._relationStore) {
      this._relationStore = new RelationStore(this.getDb());
    }
    return this._relationStore;
  }

  private getSearchEngine(): SearchEngine {
    if (!this._searchEngine) {
      this._searchEngine = new SearchEngine(this.getDb());
    }
    return this._searchEngine;
  }

  private getInjectStore(): MemoryInjectStore {
    if (!this._injectStore) {
      this._injectStore = new MemoryInjectStore(this.getDb());
    }
    return this._injectStore;
  }

  private getInjector(): AutoRecallInjector {
    if (!this._injector) {
      this._injector = new AutoRecallInjector(
        this.getSearchEngine(),
        this.getEntityStore(),
        this.getInjectStore(),
        this.getLineageTraverser(),  // Phase 4: lineage-aware memory injection
        this.maxRecallTokens
      );
    }
    return this._injector;
  }

  private getLineageTraverser(): LineageTraverser {
    if (!this._lineageTraverser) {
      this._lineageTraverser = new LineageTraverser(
        this.getSummaryStore(),
        this.getMessageStore()
      );
    }
    return this._lineageTraverser;
  }

  private getDropper(): SmartDropper {
    if (!this._dropper) {
      // Pass LLMCaller for LLM-powered importance scoring; undefined falls back to keyword scoring
      // Pass dropThreshold from config for consistent threshold
      this._dropper = new SmartDropper(this.getDb(), this._llmCaller ?? undefined, this.dropThreshold);
    }
    return this._dropper;
  }

  /**
   * Get Trimmer instance (lazy initialization)
   * Used by llmCompaction() to trim messages before summarization
   */
  private getTrimmer(): Trimmer {
    if (!this._trimmer) {
      this._trimmer = new Trimmer({
        stubThreshold: this.trimStubThreshold,
        stripBase64: this.trimStripBase64,
        stripThinkingBlocks: this.trimStripThinkingBlocks,
      });
    }
    return this._trimmer;
  }

  private getContextStore(): ContextStore {
    if (!this._ctxStore) {
      this._ctxStore = new ContextStore(
        this.getMessageStore(),
        this.getSessionManager(),
        this.getSummaryStore(),
        this.freshTailCount,
        this.contextWindow
      );
    }
    return this._ctxStore;
  }

  private getProjectManager(): ProjectManager {
    if (!this._projectManager) {
      this._projectManager = new ProjectManager(this.getDb());
    }
    return this._projectManager;
  }

  private getLargeFileStore(): LargeFileStore {
    if (!this._largeFileStore) {
      // Create TextSummarizer from LLMCaller if available
      const summarizer = this._llmCaller
        ? async (prompt: string): Promise<string | null> => {
            try {
              const result = await this._llmCaller!.generate(
                prompt,
                'You are a context compression assistant. Provide concise summaries.',
                { maxTokens: 1000 }
              );
              return result.content ?? null;
            } catch {
              return null;
            }
          }
        : undefined;
      this._largeFileStore = new LargeFileStore(this.getDb(), summarizer);
    }
    return this._largeFileStore;
  }
}

/**
 * Plugin registration function
 * 
 * Called by OpenClaw to register this as a context engine.
 * 
 * @param api - OpenClaw plugin API
 * @param api.registerContextEngine - Function to register this engine
 * 
 * @example
 * // In OpenClaw plugin:
 * const { QuantumContextEngine } = require('./dist/engine/QuantumEngine.js');
 * 
 * module.exports = function register(api) {
 *   const engine = new QuantumContextEngine();
 *   engine.setTools(api.tools); // Enable LLM features
 *   api.registerContextEngine('quantum-memory', () => engine);
 * };
 */
export function registerQuantumMemory(api: {
  registerContextEngine: (id: string, factory: () => ContextEngine) => void;
  tools?: Record<string, any>;
}, params?: {
  onEngineCreated?: (engine: QuantumContextEngine) => void;
}): QuantumContextEngine {
  console.log('[QuantumMemory] Registering context engine');
  
  // Pass openclaw config so QuantumConfig can be resolved
  const engine = new QuantumContextEngine(api);
  
  // Fire callback after engine is created
  params?.onEngineCreated?.(engine);
  
  // Enable LLM if tools available
  if (api.tools) {
    engine.setTools(api.tools);
  }
  
  api.registerContextEngine('quantum-memory', () => engine);
  
  return engine;
}
