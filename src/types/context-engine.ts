// OpenClaw Context Engine types - stubs for quantum-memory

// Re-export AgentMessage from pi-agent-core
export type { AgentMessage } from '@mariozechner/pi-agent-core/dist/types.js';

export interface ContextEngineInfo {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
}

export interface AssembleResult {
  messages: any[];
  estimatedTokens: number;
  systemPromptAddition?: string;
}

export interface CompactResult {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore: number;
    tokensAfter?: number;
    details?: unknown;
  };
}

export interface IngestResult {
  ingested: boolean;
}

export interface IngestBatchResult {
  ingestedCount: number;
}

export interface BootstrapResult {
  bootstrapped: boolean;
  importedMessages?: number;
  reason?: string;
}

export interface SubagentSpawnPreparation {
  rollback: () => void | Promise<void>;
}

export type SubagentEndReason = 'deleted' | 'completed' | 'swept' | 'released';

export interface ContextEngine {
  readonly info: ContextEngineInfo;
  bootstrap?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
  }): Promise<BootstrapResult>;
  ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: any;
    isHeartbeat?: boolean;
  }): Promise<IngestResult>;
  ingestBatch?(params: {
    sessionId: string;
    sessionKey?: string;
    messages: any[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult>;
  afterTurn?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: any[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
  }): Promise<void>;
  assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: any[];
    tokenBudget?: number;
  }): Promise<AssembleResult>;
  compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: 'budget' | 'threshold';
    customInstructions?: string;
  }): Promise<CompactResult>;
  prepareSubagentSpawn?(params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined>;
  onSubagentEnded?(params: {
    childSessionKey: string;
    reason: SubagentEndReason;
  }): Promise<void>;
  dispose?(): Promise<void>;
}
