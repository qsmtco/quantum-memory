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
import { extractEntities, estimateTokens } from '../utils/EntityExtractor.js';
import { LLMCaller } from '../utils/LLMCaller.js';

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

  // LLM caller for summarization
  private _llmCaller: LLMCaller | null = null;
  private _tools: Record<string, any> | null = null;

  // Configuration
  private freshTailCount = 32;
  private contextThreshold = 0.75;

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
  setTools(tools: Record<string, any>): void {
    this._tools = tools;
    this._llmCaller = new LLMCaller(tools);
    console.log('[QuantumMemory] LLM tools configured:', this._llmCaller.getToolName() || 'none');
  }

  /**
   * Check if LLM is available for summarization
   */
  isLLMAvailable(): boolean {
    return this._llmCaller?.isAvailable() ?? false;
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
    const db = this.getDb();
    const msgStore = this.getMessageStore();
    const entityStore = this.getEntityStore();
    const relationStore = this.getRelationStore();

    // Skip heartbeats for entity extraction (not worth the overhead)
    if (params.isHeartbeat) {
      const stored = msgStore.createBatch(
        params.sessionId,
        params.messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
      );
      return { ingestedCount: stored.length };
    }

    // Process each message - extract content as string (AgentMessage content can be complex)
    const stored = msgStore.createBatch(
      params.sessionId,
      params.messages.map(m => ({ 
        role: m.role, 
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) 
      }))
    );

    // Extract and store entities from each message
    for (let i = 0; i < params.messages.length; i++) {
      const msg = params.messages[i];
      // Handle complex content types - extract string content
      const text = typeof msg.content === 'string' ? msg.content : '';
      
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
        content: `[Earlier Context]\n${item.content}`,
      });
    }

    // Add fresh messages
    for (const item of contextResult.items.filter(i => i.type === 'message')) {
      assembled.push({
        role: item.role as any,
        content: item.content,
      });
    }

    // Auto-recall: inject relevant memories from past
    let injectionUsed = false;
    if (this._injector) {
      const recentContent = params.messages.slice(-3).map(m => typeof m.content === 'string' ? m.content : '').join(' ');
      
      const injection = this._injector.inject(params.sessionId, recentContent, {
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
    const totalTokens = assembled.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0);

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

    // Check if LLM available
    if (!this._llmCaller?.isAvailable()) {
      console.warn('[QuantumMemory] No LLM available for summarization');
      return {
        ok: false,
        compacted: false,
        reason: 'LLM not available',
      };
    }

    try {
      // Build content to summarize
      const content = toSummarize.map(m => m.content).join('\n\n---\n\n');
      
      // Determine current DAG level
      const currentLevel = summaryStore.getMaxLevel(params.sessionId) + 1;

      // Create summary prompt
      const summaryPrompt = params.customInstructions 
        ? `${params.customInstructions}\n\nSummarize this conversation:\n\n${content}`
        : `Summarize this conversation concisely while preserving:
- Key decisions and conclusions
- Important names, projects, and tools
- Technical details needed to continue
- Any errors or issues encountered

Conversation:
${content}`;

      // Call LLM for summarization
      const summaryResponse = await this._llmCaller!.generate(
        summaryPrompt,
        'You are a helpful assistant that creates concise summaries.',
        { maxTokens: 1000 }
      );

      const summaryText = summaryResponse.content;

      // Create summary in DAG
      summaryStore.create(params.sessionId, currentLevel, summaryText, {
        sourceMessageIds: toSummarize.map(m => m.id),
        modelUsed: summaryResponse.model,
      });

      // Mark messages as compacted
      msgStore.markCompacted(toSummarize.map(m => m.id));

      // Calculate new token count
      const newTokens = ctxStore.getTokenCount(params.sessionId);

      console.log(`[QuantumMemory] Compaction complete: ${toSummarize.length} messages → ${currentLevel} level summary`);

      return {
        ok: true,
        compacted: true,
        result: {
          summary: summaryText,
          tokensBefore: currentTokens,
          tokensAfter: newTokens,
          details: {
            messagesCompacted: toSummarize.length,
            summaryLevel: currentLevel,
          },
        },
      };
    } catch (error) {
      console.error('[QuantumMemory] Compaction failed:', error);
      return {
        ok: false,
        compacted: false,
        reason: `compaction failed: ${error}`,
      };
    }
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
        this.getInjectStore()
      );
    }
    return this._injector;
  }

  private getDropper(): SmartDropper {
    if (!this._dropper) {
      this._dropper = new SmartDropper(this.getDb());
    }
    return this._dropper;
  }

  private getContextStore(): ContextStore {
    if (!this._ctxStore) {
      this._ctxStore = new ContextStore(
        this.getMessageStore(),
        this.getSessionManager(),
        this.getSummaryStore(),
        this.freshTailCount
      );
    }
    return this._ctxStore;
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
}): void {
  console.log('[QuantumMemory] Registering context engine');
  
  const engine = new QuantumContextEngine();
  
  // Enable LLM if tools available
  if (api.tools) {
    engine.setTools(api.tools);
  }
  
  api.registerContextEngine('quantum-memory', () => engine);
}
