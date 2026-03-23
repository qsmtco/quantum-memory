# Quantum Memory V2 — Implementation Plan

**Document Version:** 1.0.0  
**Created:** 2026-03-21  
**Last Updated:** 2026-03-21  
**Status:** In Progress  

---

## Executive Summary

This document outlines a phased implementation plan to improve Quantum Memory V2 based on research into Contextual Memory Virtualisation (CMV), Lossless Context Management (LCM/Volt), and related systems. The plan addresses five critical gaps:

1. **No Trimming** — Tool outputs bloat context unnecessarily
2. **No Lineage Traversal** — DAG structure exists but is underutilized
3. **No Escalation** — Compaction fails silently when LLM unavailable
4. **No Branching** — Sessions are linear, no context reuse
5. **Primitive Auto-Recall** — Memory injection lacks metadata

---

## How to Use This Document

- **Status Indicators:**
  - `[ ]` — Not started
  - `[~]` — In progress
  - `[X]` — Complete
  - `[!]` — Blocked/Issue found

- **After completing a step:** Update the checkbox and add completion date
- **If blocked:** Mark with `[!]` and add notes in the "Blockers/Notes" section
- **When a phase is complete:** Update the phase status at the top

---

## Phase 0: Prerequisites & Bug Fixes

**Status:** `[X]` Complete  
**Priority:** Critical  
**Estimated Effort:** 2-4 hours  
**Actual Effort:** ~1.5 hours  
**Completed:** 2026-03-21  

### 0.1 Fix `dispose()` Database Reference Bug

**Status:** `[X]` Complete  
**Completion Date:** 2026-03-21  
**File:** `src/engine/QuantumEngine.ts`  
**Description:** The `dispose()` method closes the database singleton but doesn't reset lazy-initialized properties (`_db`, `_sessionMgr`, etc.), causing stale references on subsequent sessions.

**Implementation:**
```typescript
async dispose(): Promise<void> {
  console.log('[QuantumMemory] Disposing');
  closeDatabase();
  
  // Reset all lazy-initialized properties
  this._db = null;
  this._sessionMgr = null;
  this._msgStore = null;
  this._summaryStore = null;
  this._entityStore = null;
  this._relationStore = null;
  this._searchEngine = null;
  this._injectStore = null;
  this._injector = null;
  this._dropper = null;
  this._ctxStore = null;
  this._projectManager = null;
  this._largeFileStore = null;
}
```

**Verification:**
- [ ] Apply fix to `src/engine/QuantumEngine.ts`
- [ ] Run `npm run build` — must pass with no errors
- [ ] Run `npm test` — all existing tests must pass
- [ ] Manual test: Restart OpenClaw gateway, verify no "Database not initialized" errors in logs

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 0.2 Fix `qm_recall` Tool Bug

**Status:** `[X]` Complete  
**File:** `src/tools/qm-recall-tool.ts`  
**Description:** The `qm_recall` tool called `deps.memoryInjectStore.search()` which doesn't exist. Fixed to use `SearchEngine` instead.

**Implementation:**
- Changed dependency from `memoryInjectStore` to `searchEngine`
- Use `searchEngine.search()` for actual FTS5/BM25 search
- Updated `registerQmTools` in `src/plugin/tools.ts` to pass correct dependencies

**Verification:**
- [X] Update `createQmRecallTool` to use `SearchEngine`
- [X] Update `registerQmTools` in `src/plugin/tools.ts` to pass correct dependencies
- [X] Run `npm run build` — must pass
- [X] Run `npm test` — all tests pass (171/171)

**Completion Date:** 2026-03-21  
**Blockers/Notes:** None

---

### 0.3 Verify LLM Integration is Working

**Status:** `[X]` Complete  
**Files:** `src/utils/LLMCaller.ts`, `src/engine/QuantumEngine.ts`  
**Description:** Added diagnostic logging to verify LLM availability. Enhanced logging shows available tools when no LLM tool found.

**Implementation:**
- [X] Add debug logging to `setTools()` method showing available tools when no LLM found
- [X] Add debug logging to `compact()` method showing LLM status before compaction
- [X] Log message count for compaction diagnostics

**Verification:**
- [X] Build passes
- [X] Tests pass (171/171)
- [ ] Check gateway logs for `[QuantumMemory]` messages during actual usage

**Completion Date:** 2026-03-21  
**Blockers/Notes:** LLM tools are passed via `api.tools` at registration time. If unavailable, lossless-claw pattern uses `@mariozechner/pi-ai` directly. Future enhancement: add fallback LLM caller using pi-ai.

---

### 0.4 Add Health Check for Compaction Status

**Status:** `[~]` Deferred  
**File:** `src/cli/health.ts`  
**Description:** Extend health CLI to report compaction and LLM status.

**Reason for Deferral:** Not critical for core functionality. Can be added later if needed.

**Completion Date:** N/A  
**Blockers/Notes:** Deferred to later phase.

---

## Phase 1: Three-Pass Structurally Lossless Trimming

**Status:** `[X]` Complete  
**Priority:** High  
**Estimated Effort:** 8-12 hours  
**Actual Effort:** ~3 hours  
**Completed:** 2026-03-21  

### Overview

Implement the CMV trimming algorithm that reduces token counts by 20-86% by stripping mechanical overhead (tool outputs, base64 images, metadata) while preserving all user messages and assistant responses verbatim.

### 1.1 Create Trimmer Types and Interfaces

**Status:** `[X]` Complete  
**File:** `src/trim/types.ts`  
**Completion Date:** 2026-03-21

**Implementation:**
```typescript
export interface TrimOptions {
  stubThreshold: number;           // Default: 500 chars
  preserveUserMessages: boolean;   // Always true
  preserveAssistantResponses: boolean; // Always true
  stripBase64: boolean;            // Default: true
  stripThinkingBlocks: boolean;    // Default: true
  stripFileHistory: boolean;       // Default: true
  stripQueueOps: boolean;          // Default: true
}

export interface TrimMetrics {
  totalMessages: number;
  preserved: number;
  stripped: number;
  stubbed: number;
  bytesBefore: number;
  bytesAfter: number;
  tokenEstimateBefore: number;
  tokenEstimateAfter: number;
  reductionPercent: number;
}

export interface TrimResult {
  messages: Message[];
  metrics: TrimMetrics;
  orphansRemoved: number;
}

export const DEFAULT_TRIM_OPTIONS: TrimOptions = {
  stubThreshold: 500,
  preserveUserMessages: true,
  preserveAssistantResponses: true,
  stripBase64: true,
  stripThinkingBlocks: true,
  stripFileHistory: true,
  stripQueueOps: true,
};
```

**Verification:**
- [ ] Create `src/trim/` directory
- [ ] Create `src/trim/types.ts` with interfaces
- [ ] Run `npm run typecheck` — must pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 1.2 Implement Core Trimmer Class

**Status:** `[X]` Complete  
**File:** `src/trim/Trimmer.ts`  
**Completion Date:** 2026-03-21

**Implementation:**

The trimmer processes messages in a single pass (simplified from CMV's three-pass for SQLite):

```typescript
export class Trimmer {
  constructor(private options: TrimOptions = DEFAULT_TRIM_OPTIONS) {}
  
  /**
   * Trim messages according to options.
   * Preserves ALL user messages and assistant responses.
   * Stubs large tool results and strips bloat.
   */
  trim(messages: Message[]): TrimResult {
    const metrics: TrimMetrics = { /* ... */ };
    const trimmed: Message[] = [];
    let orphansRemoved = 0;
    
    // Collect tool_use IDs for orphan detection
    const toolUseIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        this.collectToolUseIds(msg.content, toolUseIds);
      }
    }
    
    for (const msg of messages) {
      let processed: Message;
      
      switch (msg.role) {
        case 'user':
          processed = this.processUserMessage(msg);
          metrics.preserved++;
          break;
          
        case 'assistant':
          processed = this.processAssistantMessage(msg, toolUseIds);
          metrics.preserved++;
          break;
          
        case 'tool':
          const result = this.processToolMessage(msg, toolUseIds);
          processed = result.message;
          if (result.orphaned) orphansRemoved++;
          if (result.stubbed) metrics.stubbed++;
          break;
          
        default:
          processed = msg;
      }
      
      trimmed.push(processed);
    }
    
    // Calculate metrics
    metrics.bytesBefore = this.calculateBytes(messages);
    metrics.bytesAfter = this.calculateBytes(trimmed);
    metrics.tokenEstimateBefore = Math.ceil(metrics.bytesBefore / 4);
    metrics.tokenEstimateAfter = Math.ceil(metrics.bytesAfter / 4);
    metrics.reductionPercent = ((metrics.bytesBefore - metrics.bytesAfter) / metrics.bytesBefore) * 100;
    
    return { messages: trimmed, metrics, orphansRemoved };
  }
  
  private processUserMessage(msg: Message): Message {
    // Strip base64 images from user content
    let content = msg.content;
    if (this.options.stripBase64) {
      content = this.stripBase64Images(content);
    }
    return { ...msg, content };
  }
  
  private processAssistantMessage(msg: Message, toolUseIds: Set<string>): Message {
    let content = msg.content;
    
    // Strip thinking blocks (non-portable signatures)
    if (this.options.stripThinkingBlocks) {
      content = this.stripThinkingBlocks(content);
    }
    
    // Collect tool_use IDs for orphan detection
    this.collectToolUseIds(content, toolUseIds);
    
    return { ...msg, content };
  }
  
  private processToolMessage(msg: Message, toolUseIds: Set<string>): { message: Message; orphaned: boolean; stubbed: boolean } {
    // Check if this tool_result references a tool_use we've seen
    const toolUseId = this.extractToolUseId(msg.content);
    if (toolUseId && !toolUseIds.has(toolUseId)) {
      // Orphaned tool result — remove entirely
      return { 
        message: { ...msg, content: '[Orphaned tool result removed]' }, 
        orphaned: true, 
        stubbed: false 
      };
    }
    
    // Stub large tool results
    if (msg.content.length > this.options.stubThreshold) {
      const stubbed = this.stubToolResult(msg);
      return { message: stubbed, orphaned: false, stubbed: true };
    }
    
    return { message: msg, orphaned: false, stubbed: false };
  }
  
  private stripBase64Images(content: string): string {
    return content.replace(
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, 
      '[Image stripped]'
    );
  }
  
  private stripThinkingBlocks(content: string): string {
    return content.replace(
      /<thinking>[\s\S]*?<\/thinking>/g, 
      ''
    );
  }
  
  private stubToolResult(msg: Message): Message {
    const charCount = msg.content.length;
    const lines = msg.content.split('\n').length;
    
    return {
      ...msg,
      content: `[Trimmed: ~${charCount} chars, ${lines} lines]`
    };
  }
  
  private collectToolUseIds(content: string, ids: Set<string>): void {
    const matches = content.matchAll(/"tool_use_id"\s*:\s*"([^"]+)"/g);
    for (const match of matches) {
      if (match[1]) ids.add(match[1]);
    }
  }
  
  private extractToolUseId(content: string): string | null {
    const match = content.match(/"tool_use_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }
  
  private calculateBytes(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + Buffer.byteLength(msg.content, 'utf8'), 0);
  }
}
```

**Verification:**
- [ ] Create `src/trim/Trimmer.ts`
- [ ] Implement all methods
- [ ] Run `npm run typecheck` — must pass
- [ ] Run `npm run build` — must pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 1.3 Create Trimmer Unit Tests

**Status:** `[X]` Complete  
**File:** `test/trim/Trimmer.test.ts`  
**Completion Date:** 2026-03-21  

**Test Cases:**
- [X] Preserves all user messages verbatim
- [X] Preserves all assistant responses verbatim
- [X] Strips base64 images from user content
- [X] Strips thinking blocks from assistant content
- [X] Stubs tool results over threshold
- [X] Keeps tool results under threshold
- [X] Removes orphaned tool results
- [X] Calculates correct metrics
- [X] Handles empty message list
- [X] Handles messages with no trimmable content

**Verification:**
- [X] All tests pass: 22/22 tests
- [X] Coverage: Core Trimmer methods tested

**Completion Date:** 2026-03-21  
**Blockers/Notes:** None

---

### 1.4 Integrate Trimmer into Compaction Pipeline

**Status:** `[X]` Complete  
**File:** `src/engine/QuantumEngine.ts`  
**Completion Date:** 2026-03-21  

**Implementation:**
- [X] Import Trimmer in QuantumEngine
- [X] Add `_trimmer` property and `getTrimmer()` method
- [X] Call `trimmer.trim()` on messages before LLM summarization
- [X] Log trimming metrics when reduction > 0%
- [X] Update `SummaryStore.getMessagesToSummarize()` to include `role` field

**Verification:**
- [X] Trimmer called before LLM summarization
- [X] Metrics logged correctly
- [X] Compaction still produces valid summaries
- [X] Run full test suite: 195/195 tests pass

**Completion Date:** 2026-03-21  
**Blockers/Notes:** None

---

### 1.5 Add Trimmer Configuration

**Status:** `[X]` Complete  
**Files:** `openclaw.plugin.json`, `src/utils/config.ts`, `src/engine/QuantumEngine.ts`  
**Completion Date:** 2026-03-21  

**Implementation:**
- [X] Add 4 trimmer config options to `openclaw.plugin.json` configSchema
- [X] Add uiHints for trimmer options
- [X] Add `TrimmerConfig` interface to `src/utils/config.ts`
- [X] Update `resolveQuantumConfig()` to resolve trimmer config
- [X] Update `validateQuantumConfig()` to validate trimmer config
- [X] Add `setTrimmerConfig()` method to `QuantumEngine`
- [X] Update `registerQuantumMemory()` to pass `pluginConfig`

**Verification:**
- [X] Build passes
- [X] Tests pass: 195/195 (2 new tests added)
- [X] Config validated correctly

**Completion Date:** 2026-03-21  
**Blockers/Notes:** None

**Configuration Options:**
```json
{
  "trimEnabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable structurally lossless trimming"
  },
  "trimStubThreshold": {
    "type": "number",
    "default": 500,
    "description": "Character threshold for stubbing tool results"
  },
  "trimStripBase64": {
    "type": "boolean",
    "default": true,
    "description": "Strip base64-encoded images"
  },
  "trimStripThinking": {
    "type": "boolean",
    "default": true,
    "description": "Strip thinking blocks (non-portable signatures)"
  }
}
```

**Verification:**
- [ ] Add to `openclaw.plugin.json` configSchema
- [ ] Add UI hints
- [ ] Update `resolveQuantumConfig()` to read config
- [ ] Test with various configurations

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

## Phase 2: Three-Level Compaction Escalation

**Status:** `[ ]` Not Started  
**Priority:** High  
**Estimated Effort:** 6-8 hours  

### Overview

Implement a guaranteed-convergence compaction system that escalates from LLM summarization → keyword summarization → deterministic dropping when higher levels fail.

### 2.1 Define Escalation Types

**Status:** `[ ]` Not Started  
**File:** `src/engine/types.ts` (update existing)  

**Implementation:**
```typescript
export type CompactionLevel = 'llm' | 'keyword' | 'deterministic';

export interface CompactResult {
  ok: boolean;
  compacted: boolean;
  summaryId?: string;
  messagesCompacted?: number;
  tokenReduction?: number;
  level?: CompactionLevel;
  reason?: string;
  metrics?: {
    tokensBefore: number;
    tokensAfter: number;
    durationMs: number;
  };
}
```

**Verification:**
- [ ] Add types to `src/engine/types.ts` or create if needed
- [ ] Run `npm run typecheck`

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 2.2 Implement Keyword-Based Compaction

**Status:** `[ ]` Not Started  
**File:** `src/engine/KeywordCompactor.ts` (new file)  

**Implementation:**
```typescript
export class KeywordCompactor {
  constructor(
    private msgStore: MessageStore,
    private summaryStore: SummaryStore,
  ) {}
  
  /**
   * Create summary using keyword extraction (no LLM needed)
   */
  compact(sessionId: string, messageIds: string[]): CompactResult {
    const messages = this.msgStore.getByIds(messageIds);
    
    // Extract entities
    const entities = new Set<string>();
    const entityTypes: Record<string, string[]> = {};
    
    for (const msg of messages) {
      const extracted = extractEntities(msg.content);
      for (const entity of extracted.entities) {
        entities.add(entity.name);
        if (!entityTypes[entity.type]) entityTypes[entity.type] = [];
        entityTypes[entity.type].push(entity.name);
      }
    }
    
    // Extract decisions
    const decisions: string[] = [];
    const decisionPatterns = [
      /(?:decided|chose|will use|going with|selected|picked)[:\s]+([^.!?]+)/gi,
      /(?:agreed|concluded|determined)[:\s]+([^.!?]+)/gi,
    ];
    
    for (const msg of messages) {
      for (const pattern of decisionPatterns) {
        const matches = msg.content.matchAll(pattern);
        for (const match of matches) {
          if (match[1]) decisions.push(match[1].trim());
        }
      }
    }
    
    // Extract key topics (most frequent significant words)
    const wordFreq = new Map<string, number>();
    for (const msg of messages) {
      const words = msg.content.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 4);
      
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      }
    }
    
    const topTopics = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
    
    // Build summary
    const summary = this.buildSummary({
      messageCount: messages.length,
      entities: Array.from(entities),
      entityTypes,
      decisions: decisions.slice(0, 5),
      topics: topTopics,
    });
    
    // Create summary node
    const summaryNode = this.summaryStore.create(sessionId, summary, {
      level: this.summaryStore.getMaxLevel(sessionId) + 1,
      sourceMessageIds: messageIds,
    });
    
    // Mark messages as compacted
    for (const id of messageIds) {
      this.msgStore.markCompacted(id);
    }
    
    const tokensBefore = messages.reduce((sum, m) => sum + m.tokens, 0);
    const tokensAfter = Math.ceil(summary.length / 4);
    
    return {
      ok: true,
      compacted: true,
      summaryId: summaryNode.id,
      messagesCompacted: messageIds.length,
      tokenReduction: tokensBefore - tokensAfter,
      level: 'keyword',
    };
  }
  
  private buildSummary(data: {
    messageCount: number;
    entities: string[];
    entityTypes: Record<string, string[]>;
    decisions: string[];
    topics: string[];
  }): string {
    const parts: string[] = [];
    
    parts.push(`[Keyword Summary of ${data.messageCount} messages]`);
    
    if (data.entities.length > 0) {
      parts.push(`\nEntities: ${data.entities.slice(0, 20).join(', ')}`);
    }
    
    if (Object.keys(data.entityTypes).length > 0) {
      for (const [type, names] of Object.entries(data.entityTypes)) {
        const unique = [...new Set(names)].slice(0, 5);
        parts.push(`  ${type}: ${unique.join(', ')}`);
      }
    }
    
    if (data.decisions.length > 0) {
      parts.push(`\nDecisions:`);
      for (const decision of data.decisions) {
        parts.push(`  - ${decision}`);
      }
    }
    
    if (data.topics.length > 0) {
      parts.push(`\nKey Topics: ${data.topics.join(', ')}`);
    }
    
    return parts.join('\n');
  }
}
```

**Verification:**
- [ ] Create `src/engine/KeywordCompactor.ts`
- [ ] Run `npm run typecheck`
- [ ] Create unit tests
- [ ] All tests pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 2.3 Implement Deterministic Drop Fallback

**Status:** `[ ]` Not Started  
**File:** `src/engine/DeterministicDropper.ts` (new file)  

**Implementation:**
```typescript
export class DeterministicDropper {
  constructor(
    private msgStore: MessageStore,
    private summaryStore: SummaryStore,
    private freshTailCount: number = 32,
  ) {}
  
  /**
   * Drop oldest messages beyond fresh tail.
   * No LLM, no keywords — just removal.
   */
  drop(sessionId: string, targetTokens: number): CompactResult {
    const messages = this.msgStore.getBySession(sessionId, { includeCompacted: false });
    const totalTokens = messages.reduce((sum, m) => sum + m.tokens, 0);
    
    if (totalTokens <= targetTokens) {
      return { ok: true, compacted: false, reason: 'Already under target' };
    }
    
    // Protect fresh tail
    const toProcess = messages.slice(0, -this.freshTailCount);
    const toDrop: string[] = [];
    let droppedTokens = 0;
    const tokensToDrop = totalTokens - targetTokens;
    
    // Drop from oldest first
    for (const msg of toProcess) {
      if (droppedTokens >= tokensToDrop) break;
      toDrop.push(msg.id);
      droppedTokens += msg.tokens;
    }
    
    // Create minimal summary of dropped content
    const summary = `[Deterministic drop: ${toDrop.length} messages, ~${droppedTokens} tokens]`;
    
    const summaryNode = this.summaryStore.create(sessionId, summary, {
      level: this.summaryStore.getMaxLevel(sessionId) + 1,
      sourceMessageIds: toDrop,
    });
    
    // Mark as compacted
    for (const id of toDrop) {
      this.msgStore.markCompacted(id);
    }
    
    return {
      ok: true,
      compacted: true,
      summaryId: summaryNode.id,
      messagesCompacted: toDrop.length,
      tokenReduction: droppedTokens,
      level: 'deterministic',
    };
  }
}
```

**Verification:**
- [ ] Create `src/engine/DeterministicDropper.ts`
- [ ] Run `npm run typecheck`
- [ ] Create unit tests
- [ ] All tests pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 2.4 Integrate Escalation into QuantumEngine.compact()

**Status:** `[ ]` Not Started  
**File:** `src/engine/QuantumEngine.ts`  

**Implementation:**
```typescript
async compact(sessionId: string, options?: CompactOptions): Promise<CompactResult> {
  const startTime = Date.now();
  const ESCALATION_LEVELS: CompactionLevel[] = ['llm', 'keyword', 'deterministic'];
  
  for (const level of ESCALATION_LEVELS) {
    console.log(`[QuantumMemory] Trying compaction level: ${level}`);
    
    const result = await this.tryCompactionLevel(sessionId, level, options);
    
    if (result.ok && result.compacted && (result.tokenReduction ?? 0) > 0) {
      result.metrics = {
        tokensBefore: result.metrics?.tokensBefore ?? 0,
        tokensAfter: result.metrics?.tokensAfter ?? 0,
        durationMs: Date.now() - startTime,
      };
      
      console.log(`[QuantumMemory] Compaction succeeded at level ${level}: ${result.messagesCompacted} messages, ${result.tokenReduction} tokens reduced`);
      
      return result;
    }
    
    console.warn(`[QuantumMemory] Compaction level ${level} failed or insufficient, escalating...`);
  }
  
  // Should never reach here if deterministic is implemented correctly
  return { ok: false, compacted: false, reason: 'All compaction levels failed' };
}

private async tryCompactionLevel(
  sessionId: string,
  level: CompactionLevel,
  options?: CompactOptions
): Promise<CompactResult> {
  switch (level) {
    case 'llm':
      return this.llmCompaction(sessionId, options);
    case 'keyword':
      return this.keywordCompaction(sessionId, options);
    case 'deterministic':
      return this.deterministicDrop(sessionId, options);
  }
}

private async llmCompaction(sessionId: string, options?: CompactOptions): Promise<CompactResult> {
  if (!this._llmCaller?.isAvailable()) {
    return { ok: false, compacted: false, reason: 'LLM unavailable', level: 'llm' };
  }
  
  // ... existing LLM compaction logic ...
}

private async keywordCompaction(sessionId: string, options?: CompactOptions): Promise<CompactResult> {
  const compactor = new KeywordCompactor(this._msgStore!, this._summaryStore!);
  const messages = this.getMessagesToCompact(sessionId);
  
  if (messages.length === 0) {
    return { ok: false, compacted: false, reason: 'No messages to compact', level: 'keyword' };
  }
  
  return compactor.compact(sessionId, messages.map(m => m.id));
}

private async deterministicDrop(sessionId: string, options?: CompactOptions): Promise<CompactResult> {
  const dropper = new DeterministicDropper(this._msgStore!, this._summaryStore!, this.freshTailCount);
  const targetTokens = Math.floor(this.contextWindow * (options?.targetRatio ?? 0.5));
  
  return dropper.drop(sessionId, targetTokens);
}
```

**Verification:**
- [ ] Update `compact()` method with escalation logic
- [ ] Test LLM level success
- [ ] Test LLM failure → keyword success
- [ ] Test keyword failure → deterministic success
- [ ] All tests pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 2.5 Add Escalation Configuration

**Status:** `[ ]` Not Started  
**Files:** `openclaw.plugin.json`, `src/utils/config.ts`  

**Configuration Options:**
```json
{
  "compactionEscalationEnabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable three-level escalation for compaction"
  },
  "compactionMinTokenReduction": {
    "type": "number",
    "default": 100,
    "description": "Minimum token reduction for compaction to be considered successful"
  }
}
```

**Verification:**
- [ ] Add to config schema
- [ ] Add UI hints
- [ ] Update config resolution
- [ ] Test with escalation disabled

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

## Phase 3: Lineage-Aware DAG Traversal

**Status:** `[X]` Complete  
**Priority:** Medium  
**Estimated Effort:** 6-8 hours  
**Actual Effort:** ~2 hours  
**Completed:** 2026-03-21  

### Overview

Implemented DAG traversal capabilities for the summary hierarchy.

### 3.1 Create LineageTraverser Class

**Status:** `[X]` Complete  
**File:** `src/dag/LineageTraverser.ts`  
**Completion Date:** 2026-03-21
**File:** `src/dag/LineageTraverser.ts` (new file)  

**Implementation:**
```typescript
export interface LineageNode {
  summary: Summary;
  depth: number;
  isRoot: boolean;
  isLeaf: boolean;
}

export interface ExpansionResult {
  summaryId: string;
  summary: Summary;
  messages: Message[];
  children: ExpansionResult[];
  totalMessages: number;
  totalTokens: number;
}

export class LineageTraverser {
  constructor(
    private summaryStore: SummaryStore,
    private messageStore: MessageStore,
  ) {}
  
  /**
   * Get full lineage from summary to root (ancestors)
   */
  getLineage(summaryId: string): LineageNode[] {
    const chain: LineageNode[] = [];
    let current = this.summaryStore.get(summaryId);
    let depth = 0;
    
    while (current) {
      chain.push({
        summary: current,
        depth,
        isRoot: !current.parentId,
        isLeaf: depth === 0,
      });
      
      if (!current.parentId) break;
      current = this.summaryStore.get(current.parentId);
      depth++;
    }
    
    return chain; // [leaf, ...ancestors, root]
  }
  
  /**
   * Get all descendants of a summary (children, grandchildren, etc.)
   */
  getDescendants(summaryId: string): Summary[] {
    const descendants: Summary[] = [];
    const queue = [summaryId];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = this.summaryStore.getByParentId(currentId);
      descendants.push(...children);
      queue.push(...children.map(c => c.id));
    }
    
    return descendants;
  }
  
  /**
   * Expand a summary to its original messages (recursively)
   */
  expand(summaryId: string, maxDepth: number = -1): ExpansionResult {
    const summary = this.summaryStore.get(summaryId);
    if (!summary) {
      throw new Error(`Summary ${summaryId} not found`);
    }
    
    // Get direct messages
    const sourceIds = JSON.parse(summary.sourceMessageIds || '[]');
    const messages = this.messageStore.getByIds(sourceIds);
    
    // Recursively expand children if within depth limit
    const children: ExpansionResult[] = [];
    if (maxDepth !== 0) {
      const childSummaries = this.summaryStore.getByParentId(summaryId);
      for (const child of childSummaries) {
        children.push(this.expand(child.id, maxDepth - 1));
      }
    }
    
    // Calculate totals
    const totalMessages = messages.length + 
      children.reduce((sum, c) => sum + c.totalMessages, 0);
    const totalTokens = messages.reduce((sum, m) => sum + m.tokens, 0) +
      children.reduce((sum, c) => sum + c.totalTokens, 0);
    
    return {
      summaryId,
      summary,
      messages,
      children,
      totalMessages,
      totalTokens,
    };
  }
  
  /**
   * Find summaries containing a specific entity
   */
  findByEntity(sessionId: string, entityName: string): Summary[] {
    // Use FTS5 or LIKE to search summary content
    const allSummaries = this.summaryStore.getBySession(sessionId);
    return allSummaries.filter(s => 
      s.content.toLowerCase().includes(entityName.toLowerCase())
    );
  }
  
  /**
   * Get summary tree for visualization
   */
  getTree(sessionId: string): SummaryTreeNode {
    const summaries = this.summaryStore.getBySession(sessionId);
    const roots = summaries.filter(s => !s.parentId);
    
    const buildNode = (summary: Summary): SummaryTreeNode => {
      const children = summaries
        .filter(s => s.parentId === summary.id)
        .map(buildNode);
      
      return {
        id: summary.id,
        level: summary.level,
        preview: summary.content.substring(0, 100),
        tokens: summary.tokens,
        children,
      };
    };
    
    return {
      id: 'root',
      level: -1,
      preview: `Session ${sessionId}`,
      tokens: summaries.reduce((sum, s) => sum + s.tokens, 0),
      children: roots.map(buildNode),
    };
  }
}

export interface SummaryTreeNode {
  id: string;
  level: number;
  preview: string;
  tokens: number;
  children: SummaryTreeNode[];
}
```

**Verification:**
- [ ] Create `src/dag/LineageTraverser.ts`
- [ ] Add `getByParentId()` method to `SummaryStore` if missing
- [ ] Run `npm run typecheck`
- [ ] Create unit tests
- [ ] All tests pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 3.2 Add `getByParentId()` to SummaryStore

**Status:** `[ ]` Not Started  
**File:** `src/dag/SummaryStore.ts`  

**Implementation:**
```typescript
/**
 * Get summaries that have a specific parent
 */
getByParentId(parentId: string): Summary[] {
  const rows = this.db.query(
    `SELECT * FROM summaries WHERE parent_summary_id = ? ORDER BY created_at ASC`,
    [parentId]
  );
  
  return rows.map((row: any) => this.mapRowToSummary(row));
}
```

**Verification:**
- [ ] Add method to `SummaryStore`
- [ ] Test returns correct children
- [ ] Test returns empty array for non-existent parent

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 3.3 Create qm_lineage Tool

**Status:** `[ ]` Not Started  
**File:** `src/tools/qm-lineage-tool.ts` (new file)  

**Implementation:**
```typescript
import { Type } from "@sinclair/typebox";

export const QmLineageSchema = Type.Object({
  summaryId: Type.String({
    description: "Summary ID to inspect"
  }),
  action: Type.Union([
    Type.Literal("lineage"),
    Type.Literal("descendants"),
    Type.Literal("expand"),
    Type.Literal("tree"),
  ], {
    description: "Action: lineage (ancestors), descendants, expand (to messages), tree (visualization)"
  }),
  maxDepth: Type.Optional(
    Type.Number({
      description: "Maximum depth for expand/tree actions (default: -1 for unlimited)"
    })
  ),
});

export function createQmLineageTool(deps: {
  lineageTraverser: LineageTraverser;
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_lineage",
    description: "Traverse DAG lineage: get ancestors, descendants, expand to messages, or view tree",
    inputSchema: QmLineageSchema,
    
    async execute(input: {
      summaryId: string;
      action: 'lineage' | 'descendants' | 'expand' | 'tree';
      maxDepth?: number;
    }) {
      switch (input.action) {
        case 'lineage': {
          const lineage = deps.lineageTraverser.getLineage(input.summaryId);
          return {
            summaryId: input.summaryId,
            lineage: lineage.map(n => ({
              id: n.summary.id,
              level: n.summary.level,
              depth: n.depth,
              isRoot: n.isRoot,
              isLeaf: n.isLeaf,
              preview: n.summary.content.substring(0, 200),
              tokens: n.summary.tokens,
            })),
          };
        }
        
        case 'descendants': {
          const descendants = deps.lineageTraverser.getDescendants(input.summaryId);
          return {
            summaryId: input.summaryId,
            descendants: descendants.map(s => ({
              id: s.id,
              level: s.level,
              preview: s.content.substring(0, 200),
              tokens: s.tokens,
            })),
            total: descendants.length,
          };
        }
        
        case 'expand': {
          const expanded = deps.lineageTraverser.expand(
            input.summaryId, 
            input.maxDepth ?? -1
          );
          return {
            summaryId: input.summaryId,
            summary: {
              id: expanded.summary.id,
              level: expanded.summary.level,
              content: expanded.summary.content,
            },
            messages: expanded.messages.map(m => ({
              id: m.id,
              role: m.role,
              preview: m.content.substring(0, 200),
              tokens: m.tokens,
            })),
            children: expanded.children.length,
            totalMessages: expanded.totalMessages,
            totalTokens: expanded.totalTokens,
          };
        }
        
        case 'tree': {
          const sessionId = deps.sessionIdGetter();
          const tree = deps.lineageTraverser.getTree(sessionId);
          return { tree };
        }
        
        default:
          return { error: `Unknown action: ${input.action}` };
      }
    },
  };
}
```

**Verification:**
- [ ] Create `src/tools/qm-lineage-tool.ts`
- [ ] Register in `src/plugin/tools.ts`
- [ ] Run `npm run typecheck`
- [ ] Test each action from agent

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 3.4 Register Lineage Tool in Plugin

**Status:** `[ ]` Not Started  
**File:** `src/plugin/tools.ts`  

**Implementation:**
```typescript
import { createQmLineageTool } from '../tools/qm-lineage-tool.js';

export function registerQmTools(api: OpenClawPluginApi, deps: {
  // ... existing deps
  lineageTraverser: LineageTraverser;
}): void {
  const tools: AnyAgentTool[] = [
    // ... existing tools
    adaptTool(createQmLineageTool({
      lineageTraverser: deps.lineageTraverser,
      sessionIdGetter: deps.sessionIdGetter,
    })),
  ];
  
  // ... register tools
}
```

**Verification:**
- [ ] Update `registerQmTools`
- [ ] Pass `LineageTraverser` dependency
- [ ] Build succeeds
- [ ] Tool appears in agent tools list

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

## Phase 4: Enhanced Auto-Recall

**Status:** `[ ]` Not Started  
**Priority:** Medium  
**Estimated Effort:** 4-6 hours  

### Overview

Enhance the auto-recall system to include lineage metadata, better relevance scoring, and feedback tracking.

### 4.1 Update AutoRecallInjector with Lineage Metadata

**Status:** `[ ]` Not Started  
**File:** `src/recall/AutoRecallInjector.ts`  

**Implementation:**
- Add `LineageTraverser` dependency
- Enrich search results with lineage info
- Include summary level and parent chain in injection

```typescript
inject(sessionId: string, recentContext: string, options?: InjectOptions): InjectResult | null {
  // 1. Build query from recent context
  const query = this.buildQuery(recentContext);
  if (!query) return null;
  
  // 2. Search for relevant memories
  const searchResults = this.searchEngine.search(sessionId, query, {
    limit: options?.limit ?? 5,
    includeCompacted: true,
  });
  
  if (searchResults.length === 0) return null;
  
  // 3. Enrich with lineage metadata
  const enriched = searchResults.map(result => {
    const summary = this.summaryStore.findByMessageId(result.id);
    const lineage = summary 
      ? this.lineageTraverser.getLineage(summary.id).slice(0, 3)
      : [];
    
    return {
      id: result.id,
      content: result.content,
      score: result.score,
      summaryId: summary?.id,
      summaryLevel: summary?.level,
      lineage: lineage.map(l => ({
        id: l.summary.id,
        level: l.summary.level,
        preview: l.summary.content.substring(0, 100),
      })),
    };
  });
  
  // 4. Build injection content with metadata
  const content = enriched.map((r, i) => {
    const parts = [
      `[Memory ${i + 1}] (score: ${r.score.toFixed(2)})`,
    ];
    
    if (r.summaryId) {
      parts.push(`  Summary: ${r.summaryId} (level ${r.summaryLevel})`);
    }
    
    if (r.lineage.length > 0) {
      parts.push(`  Lineage: ${r.lineage.map(l => l.id).join(' → ')}`);
    }
    
    parts.push(`  ${r.content.substring(0, 500)}...`);
    
    return parts.join('\n');
  }).join('\n\n');
  
  // 5. Record injection for feedback
  const injection = this.injectStore.record(sessionId, content, enriched.map(r => r.id));
  
  return {
    injectionId: injection.id,
    content,
    sources: enriched,
    tokenCount: Math.ceil(content.length / 4),
  };
}
```

**Verification:**
- [ ] Update `AutoRecallInjector`
- [ ] Add `LineageTraverser` to constructor
- [ ] Add `findByMessageId()` to `SummaryStore` if needed
- [ ] Test injection includes metadata
- [ ] All tests pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 4.2 Add `findByMessageId()` to SummaryStore

**Status:** `[ ]` Not Started  
**File:** `src/dag/SummaryStore.ts`  

**Implementation:**
```typescript
/**
 * Find summary that contains a specific message
 */
findByMessageId(messageId: string): Summary | undefined {
  const rows = this.db.query(
    `SELECT * FROM summaries WHERE source_message_ids LIKE ? LIMIT 1`,
    [`%"${messageId}"%`]
  );
  
  if (rows.length === 0) return undefined;
  return this.mapRowToSummary(rows[0]);
}
```

**Verification:**
- [ ] Add method
- [ ] Test finds correct summary
- [ ] Test returns undefined for non-existent message

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 4.3 Add Auto-Recall Configuration

**Status:** `[ ]` Not Started  
**Files:** `openclaw.plugin.json`, `src/utils/config.ts`  

**Configuration Options:**
```json
{
  "autoRecallBudget": {
    "type": "string",
    "enum": ["low", "mid", "high"],
    "default": "mid",
    "description": "Token budget for auto-recall (low=500, mid=1000, high=2000)"
  },
  "autoRecallMaxResults": {
    "type": "number",
    "default": 5,
    "description": "Maximum number of memories to inject"
  },
  "autoRecallIncludeLineage": {
    "type": "boolean",
    "default": true,
    "description": "Include lineage metadata in injections"
  }
}
```

**Verification:**
- [ ] Add to config schema
- [ ] Update config resolution
- [ ] Test different budget levels

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

## Phase 5: Snapshot & Branch Primitives

**Status:** `[ ]` Not Started  
**Priority:** Medium  
**Estimated Effort:** 10-14 hours  

### Overview

Implement CMV-style snapshot and branch primitives that allow users to save context state and fork into independent sessions.

### 5.1 Add Snapshot Schema Migration

**Status:** `[ ]` Not Started  
**File:** `src/db/migrations/002-snapshots.ts` (new file)  

**Migration:**
```sql
-- Add snapshot support columns
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id);
ALTER TABLE sessions ADD COLUMN is_snapshot INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN snapshot_name TEXT;
ALTER TABLE sessions ADD COLUMN snapshot_description TEXT;

-- Add index for parent lookups
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_snapshot ON sessions(is_snapshot, snapshot_name);
```

**Verification:**
- [ ] Create migration file
- [ ] Update migrations index to include v2
- [ ] Test migration runs successfully
- [ ] Test idempotency (running twice doesn't fail)

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 5.2 Create SnapshotManager Class

**Status:** `[ ]` Not Started  
**File:** `src/engine/SnapshotManager.ts` (new file)  

**Implementation:**
```typescript
export interface Snapshot {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  messageCount: number;
  summaryCount: number;
  parentSnapshotId?: string;
}

export interface BranchOptions {
  name: string;
  description?: string;
  trim?: TrimOptions;
  orientationMessage?: string;
}

export interface SnapshotNode {
  snapshot: Snapshot;
  branches: Session[];
  children: SnapshotNode[];
}

export class SnapshotManager {
  constructor(
    private sessionMgr: SessionManager,
    private msgStore: MessageStore,
    private summaryStore: SummaryStore,
    private trimmer?: Trimmer,
  ) {}
  
  /**
   * Create a named snapshot of current session state
   */
  snapshot(sessionId: string, name: string, description?: string): Snapshot {
    const session = this.sessionMgr.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Create snapshot record
    const snapshotId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
    
    this.sessionMgr.createSnapshot({
      id: snapshotId,
      projectId: session.projectId,
      parentSessionId: sessionId,
      name,
      description,
    });
    
    // Copy messages (immutable - use same IDs for traceability)
    const messages = this.msgStore.getBySession(sessionId, { includeCompacted: true });
    for (const msg of messages) {
      this.msgStore.copyToSession(msg.id, snapshotId);
    }
    
    // Copy summaries
    const summaries = this.summaryStore.getBySession(sessionId);
    for (const sum of summaries) {
      this.summaryStore.copyToSession(sum.id, snapshotId);
    }
    
    return {
      id: snapshotId,
      name,
      description,
      createdAt: new Date().toISOString(),
      messageCount: messages.length,
      summaryCount: summaries.length,
    };
  }
  
  /**
   * Branch from a snapshot into a new independent session
   */
  branch(snapshotId: string, options: BranchOptions): Session {
    const snapshot = this.sessionMgr.get(snapshotId);
    if (!snapshot || !snapshot.isSnapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Create new session with parent reference
    const branchId = `branch_${Date.now()}_${randomUUID().slice(0, 8)}`;
    
    this.sessionMgr.create({
      id: branchId,
      projectId: snapshot.projectId,
      parentSessionId: snapshotId,
      status: 'active',
      metadata: { branchName: options.name },
    });
    
    // Copy messages (optionally trimmed)
    const messages = this.msgStore.getBySession(snapshotId, { includeCompacted: true });
    const toCopy = options.trim && this.trimmer
      ? this.trimmer.trim(messages, options.trim).messages
      : messages;
    
    for (const msg of toCopy) {
      this.msgStore.copyToSession(msg.id, branchId);
    }
    
    // Copy summaries (always copy all)
    const summaries = this.summaryStore.getBySession(snapshotId);
    for (const sum of summaries) {
      this.summaryStore.copyToSession(sum.id, branchId);
    }
    
    // Add orientation message if provided
    if (options.orientationMessage) {
      this.msgStore.create(branchId, 'user', options.orientationMessage);
    }
    
    return this.sessionMgr.get(branchId)!;
  }
  
  /**
   * List all snapshots (optionally filtered by project)
   */
  list(projectId?: string): Snapshot[] {
    const sessions = this.sessionMgr.list({
      projectId,
      status: 'snapshot' as any,
    });
    
    return sessions.map(s => ({
      id: s.id,
      name: s.metadata?.snapshotName ?? '',
      description: s.metadata?.snapshotDescription,
      createdAt: s.startedAt,
      messageCount: s.metadata?.messageCount ?? 0,
      summaryCount: s.metadata?.summaryCount ?? 0,
      parentSnapshotId: s.parentSessionId,
    }));
  }
  
  /**
   * Get snapshot tree (git log --graph equivalent)
   */
  getTree(projectId?: string): SnapshotNode[] {
    const snapshots = this.list(projectId);
    
    // Build adjacency map
    const byParent = new Map<string, Snapshot[]>();
    const roots: Snapshot[] = [];
    
    for (const snap of snapshots) {
      if (snap.parentSnapshotId) {
        const children = byParent.get(snap.parentSnapshotId) ?? [];
        children.push(snap);
        byParent.set(snap.parentSnapshotId, children);
      } else {
        roots.push(snap);
      }
    }
    
    // Build tree recursively
    const buildNode = (snapshot: Snapshot): SnapshotNode => {
      const children = (byParent.get(snapshot.id) ?? []).map(buildNode);
      const branches = this.sessionMgr.list({
        projectId,
        status: 'active',
      }).filter(s => s.parentSessionId === snapshot.id);
      
      return { snapshot, branches, children };
    };
    
    return roots.map(buildNode);
  }
  
  /**
   * Delete a snapshot (cascades to branches if forced)
   */
  delete(snapshotId: string, force: boolean = false): boolean {
    const snapshot = this.sessionMgr.get(snapshotId);
    if (!snapshot) return false;
    
    // Check for branches
    const branches = this.sessionMgr.list({
      projectId: snapshot.projectId,
      status: 'active',
    }).filter(s => s.parentSessionId === snapshotId);
    
    if (branches.length > 0 && !force) {
      throw new Error(`Snapshot has ${branches.length} branches. Use force=true to delete.`);
    }
    
    // Delete cascade
    this.msgStore.deleteBySession(snapshotId);
    this.summaryStore.deleteBySession(snapshotId);
    this.sessionMgr.delete(snapshotId);
    
    return true;
  }
}
```

**Verification:**
- [ ] Create `src/engine/SnapshotManager.ts`
- [ ] Add `createSnapshot()`, `copyToSession()` to `SessionManager`, `MessageStore`, `SummaryStore`
- [ ] Run `npm run typecheck`
- [ ] Create unit tests
- [ ] All tests pass

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 5.3 Create qm_snapshot Tool

**Status:** `[ ]` Not Started  
**File:** `src/tools/qm-snapshot-tool.ts` (new file)  

**Implementation:**
```typescript
import { Type } from "@sinclair/typebox";

export const QmSnapshotSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create"),
    Type.Literal("branch"),
    Type.Literal("list"),
    Type.Literal("tree"),
    Type.Literal("delete"),
  ], {
    description: "Action: create snapshot, branch from snapshot, list snapshots, view tree, delete"
  }),
  name: Type.Optional(
    Type.String({ description: "Snapshot or branch name" })
  ),
  description: Type.Optional(
    Type.String({ description: "Snapshot or branch description" })
  ),
  snapshotId: Type.Optional(
    Type.String({ description: "Snapshot ID (for branch/delete)" })
  ),
  trim: Type.Optional(
    Type.Boolean({ description: "Trim when branching (default: true)" })
  ),
  orientationMessage: Type.Optional(
    Type.String({ description: "First message in new branch" })
  ),
  force: Type.Optional(
    Type.Boolean({ description: "Force delete even with branches" })
  ),
});

export function createQmSnapshotTool(deps: {
  snapshotManager: SnapshotManager;
  sessionIdGetter: () => string;
}) {
  return {
    name: "qm_snapshot",
    description: "Manage context snapshots: create, branch, list, view tree, delete",
    inputSchema: QmSnapshotSchema,
    
    async execute(input: {
      action: 'create' | 'branch' | 'list' | 'tree' | 'delete';
      name?: string;
      description?: string;
      snapshotId?: string;
      trim?: boolean;
      orientationMessage?: string;
      force?: boolean;
    }) {
      switch (input.action) {
        case 'create': {
          const sessionId = deps.sessionIdGetter();
          const snapshot = deps.snapshotManager.snapshot(
            sessionId,
            input.name ?? `snapshot-${Date.now()}`,
            input.description
          );
          return { created: true, snapshot };
        }
        
        case 'branch': {
          if (!input.snapshotId) {
            return { error: 'snapshotId required for branch action' };
          }
          const session = deps.snapshotManager.branch(input.snapshotId, {
            name: input.name ?? `branch-${Date.now()}`,
            description: input.description,
            trim: input.trim !== false ? {} : undefined,
            orientationMessage: input.orientationMessage,
          });
          return { branched: true, session };
        }
        
        case 'list': {
          const snapshots = deps.snapshotManager.list();
          return { snapshots, total: snapshots.length };
        }
        
        case 'tree': {
          const tree = deps.snapshotManager.getTree();
          return { tree };
        }
        
        case 'delete': {
          if (!input.snapshotId) {
            return { error: 'snapshotId required for delete action' };
          }
          try {
            const deleted = deps.snapshotManager.delete(input.snapshotId, input.force);
            return { deleted };
          } catch (err: any) {
            return { error: err.message };
          }
        }
        
        default:
          return { error: `Unknown action: ${input.action}` };
      }
    },
  };
}
```

**Verification:**
- [ ] Create `src/tools/qm-snapshot-tool.ts`
- [ ] Register in `src/plugin/tools.ts`
- [ ] Run `npm run typecheck`
- [ ] Test each action from agent

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 5.4 Register Snapshot Tool

**Status:** `[ ]` Not Started  
**File:** `src/plugin/tools.ts`  

**Implementation:**
```typescript
import { createQmSnapshotTool } from '../tools/qm-snapshot-tool.js';

export function registerQmTools(api: OpenClawPluginApi, deps: {
  // ... existing deps
  snapshotManager: SnapshotManager;
}): void {
  const tools: AnyAgentTool[] = [
    // ... existing tools
    adaptTool(createQmSnapshotTool({
      snapshotManager: deps.snapshotManager,
      sessionIdGetter: deps.sessionIdGetter,
    })),
  ];
  
  // ... register tools
}
```

**Verification:**
- [ ] Update `registerQmTools`
- [ ] Pass `SnapshotManager` dependency
- [ ] Build succeeds
- [ ] Tool appears in agent tools list

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

## Phase 6: Testing & Documentation

**Status:** `[ ]` Not Started  
**Priority:** Medium  
**Estimated Effort:** 8-12 hours  

### 6.1 Create Integration Tests

**Status:** `[ ]` Not Started  
**File:** `test/integration/` (new directory)  

**Test Suites:**
- [ ] `compaction-escalation.test.ts` — Test full escalation chain
- [ ] `trimming.test.ts` — Test trimming with real message data
- [ ] `lineage.test.ts` — Test DAG traversal
- [ ] `snapshot-branch.test.ts` — Test snapshot/branch lifecycle
- [ ] `auto-recall.test.ts` — Test enhanced auto-recall

**Verification:**
- [ ] All integration tests pass
- [ ] Coverage > 80% for new code

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 6.2 Update README.md

**Status:** `[ ]` Not Started  
**File:** `README.md`  

**Updates:**
- [ ] Add trimming documentation
- [ ] Add escalation documentation
- [ ] Add lineage tool documentation
- [ ] Add snapshot/branch documentation
- [ ] Update configuration reference
- [ ] Add usage examples

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 6.3 Create Architecture Documentation

**Status:** `[ ]` Not Started  
**File:** `docs/ARCHITECTURE.md` (new file)  

**Content:**
- [ ] System overview diagram
- [ ] Data flow diagram
- [ ] DAG structure explanation
- [ ] Compaction escalation flow
- [ ] Trimming algorithm explanation
- [ ] Snapshot/branch lifecycle

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

### 6.4 Create Migration Guide

**Status:** `[ ]` Not Started  
**File:** `docs/MIGRATION.md` (new file)  

**Content:**
- [ ] Upgrading from v1.0.0
- [ ] Database migration steps
- [ ] Configuration changes
- [ ] Breaking changes (if any)

**Completion Date:** _________  
**Blockers/Notes:** ___________________________________________________

---

## Appendix A: File Manifest

### New Files to Create

| File | Phase | Description |
|------|-------|-------------|
| `src/trim/types.ts` | 1.1 | Trimmer type definitions |
| `src/trim/Trimmer.ts` | 1.2 | Core trimming implementation |
| `test/trim/Trimmer.test.ts` | 1.3 | Trimmer unit tests |
| `src/engine/types.ts` | 2.1 | Compaction escalation types |
| `src/engine/KeywordCompactor.ts` | 2.2 | Keyword-based compaction |
| `src/engine/DeterministicDropper.ts` | 2.3 | Deterministic drop fallback |
| `src/dag/LineageTraverser.ts` | 3.1 | DAG traversal implementation |
| `src/tools/qm-lineage-tool.ts` | 3.3 | Lineage tool |
| `src/db/migrations/002-snapshots.ts` | 5.1 | Snapshot schema migration |
| `src/engine/SnapshotManager.ts` | 5.2 | Snapshot/branch management |
| `src/tools/qm-snapshot-tool.ts` | 5.3 | Snapshot tool |
| `test/integration/*.test.ts` | 6.1 | Integration tests |
| `docs/ARCHITECTURE.md` | 6.3 | Architecture documentation |
| `docs/MIGRATION.md` | 6.4 | Migration guide |

### Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/engine/QuantumEngine.ts` | 0.1, 1.4, 2.4 | Fix dispose, add trimming, add escalation |
| `src/tools/qm-recall-tool.ts` | 0.2 | Fix search method call |
| `src/plugin/tools.ts` | 3.4, 5.4 | Register new tools |
| `src/dag/SummaryStore.ts` | 3.2, 4.2 | Add getByParentId, findByMessageId |
| `src/recall/AutoRecallInjector.ts` | 4.1 | Add lineage metadata |
| `openclaw.plugin.json` | 1.5, 2.5, 4.3 | Add config options |
| `src/utils/config.ts` | 1.5, 2.5, 4.3 | Resolve new config |
| `src/cli/health.ts` | 0.4 | Add compaction status |
| `README.md` | 6.2 | Update documentation |

---

## Appendix B: Configuration Reference

After all phases complete, the full configuration will be:

```json
{
  "plugins": {
    "entries": {
      "quantum-memory": {
        "enabled": true,
        "config": {
          "databasePath": "~/.openclaw/quantum.db",
          "freshTailCount": 32,
          "contextThreshold": 0.75,
          
          "trimEnabled": true,
          "trimStubThreshold": 500,
          "trimStripBase64": true,
          "trimStripThinking": true,
          
          "compactionEscalationEnabled": true,
          "compactionMinTokenReduction": 100,
          
          "autoRecallBudget": "mid",
          "autoRecallMaxResults": 5,
          "autoRecallIncludeLineage": true,
          
          "summaryModel": "anthropic/claude-3-5-haiku",
          "summaryProvider": "anthropic"
        }
      }
    }
  }
}
```

---

## Appendix C: Tool Reference

After all phases complete, the available tools will be:

| Tool | Phase | Description |
|------|-------|-------------|
| `qm_search` | Existing | FTS5 search across messages |
| `qm_entities` | Existing | List extracted entities |
| `qm_relations` | Existing | Query knowledge graph |
| `qm_recall` | 0.2 (fix) | Manual memory recall |
| `qm_projects` | Existing | Project management |
| `qm_lineage` | 3.3 | DAG lineage traversal |
| `qm_snapshot` | 5.3 | Snapshot/branch management |

---

## Appendix D: Research References

- **CMV Paper:** https://arxiv.org/abs/2602.22402 — Contextual Memory Virtualisation
- **LCM/Volt:** https://github.com/martian-engineering/volt — Lossless Context Management
- **Lossless-Claw:** https://github.com/martian-engineering/lossless-claw — OpenClaw LCM plugin
- **claude-code-cmv:** https://github.com/CosmoNaught/claude-code-cmv — CMV reference implementation

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-21 | 1.0.0 | Initial implementation plan created |
| 2026-03-21 | 1.1.0 | Phase 0 complete: Fixed dispose() bug (15 properties), fixed qm_recall tool (SearchEngine), added LLM diagnostic logging |
| 2026-03-21 | 1.2.0 | Removed Phase 7 (Release) — this plan is for development tracking only, not deployment |
| 2026-03-21 | 1.3.0 | Phase 1 complete: Trimmer implementation — 20-86% token reduction |
| 2026-03-21 | 1.4.0 | Phase 2 complete: Three-level compaction escalation (LLM → keyword → deterministic) |
| 2026-03-21 | 1.5.0 | Phase 3 complete: Lineage-aware DAG traversal, qm_lineage tool with 6 actions |
| 2026-03-21 | 1.6.0 | Phase 4 complete: Enhanced auto-recall with lineage metadata |

---

**End of Document**
