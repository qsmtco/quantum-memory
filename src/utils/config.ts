import { homedir } from 'os';
import { join } from 'path';

/**
 * Trimmer configuration options
 * Phase 1.5: Configurable trimming settings
 */
export interface TrimmerConfig {
  /** Enable structurally lossless trimming before compaction */
  trimEnabled: boolean;
  /** Character threshold for stubbing tool results */
  trimStubThreshold: number;
  /** Strip base64-encoded images from content */
  trimStripBase64: boolean;
  /** Strip thinking/reasoning blocks (non-portable signatures) */
  trimStripThinkingBlocks: boolean;
}

export interface QuantumConfig {
  databasePath: string;
  freshTailCount: number;
  contextThreshold: number;
  leafChunkTokens: number;
  leafTargetTokens: number;
  condensedTargetTokens: number;
  /** Max tokens for context window (used in needsCompaction) */
  contextWindow: number;
  /** Importance threshold below which messages are dropped (0.0-1.0) */
  dropThreshold: number;
  /** Max tokens for auto-recall injection */
  maxRecallTokens: number;
  /** Phase 1.5: Trimmer configuration */
  trimmer: TrimmerConfig;
}

const DEFAULT_CONFIG: QuantumConfig = {
  databasePath: '~/.openclaw/quantum.db',
  freshTailCount: 32,
  contextThreshold: 0.75,
  leafChunkTokens: 20000,
  leafTargetTokens: 1200,
  condensedTargetTokens: 2000,
  contextWindow: 32000,
  dropThreshold: 0.3,
  maxRecallTokens: 1000,
  trimmer: {
    trimEnabled: true,
    trimStubThreshold: 500,
    trimStripBase64: true,
    trimStripThinkingBlocks: true,
  },
};

function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Resolve Quantum config from OpenClaw config
 */
export function resolveQuantumConfig(openclawConfig: any): QuantumConfig {
  const pluginConfig = openclawConfig?.plugins?.entries?.['quantum-memory']?.config ?? {};
  
  // Resolve trimmer config with defaults
  const trimmerConfig: TrimmerConfig = {
    trimEnabled: pluginConfig.trimEnabled ?? DEFAULT_CONFIG.trimmer.trimEnabled,
    trimStubThreshold: pluginConfig.trimStubThreshold ?? DEFAULT_CONFIG.trimmer.trimStubThreshold,
    trimStripBase64: pluginConfig.trimStripBase64 ?? DEFAULT_CONFIG.trimmer.trimStripBase64,
    trimStripThinkingBlocks: pluginConfig.trimStripThinkingBlocks ?? DEFAULT_CONFIG.trimmer.trimStripThinkingBlocks,
  };
  
  return {
    ...DEFAULT_CONFIG,
    ...pluginConfig,
    databasePath: pluginConfig.databasePath ? expandPath(pluginConfig.databasePath) : DEFAULT_CONFIG.databasePath,
    trimmer: trimmerConfig,
  };
}

/**
 * Validate config values
 */
export function validateQuantumConfig(config: QuantumConfig): string[] {
  const errors: string[] = [];
  
  if (config.freshTailCount < 0) {
    errors.push('freshTailCount must be >= 0');
  }
  
  if (config.contextThreshold < 0 || config.contextThreshold > 1) {
    errors.push('contextThreshold must be between 0 and 1');
  }
  
  if (config.leafChunkTokens < 1000) {
    errors.push('leafChunkTokens must be >= 1000');
  }
  
  if (config.leafTargetTokens < 100) {
    errors.push('leafTargetTokens must be >= 100');
  }
  
  // Phase 1.5: Validate trimmer config
  if (config.trimmer.trimStubThreshold < 50) {
    errors.push('trimmer.trimStubThreshold must be >= 50');
  }

  if (config.contextWindow < 1000) {
    errors.push('contextWindow must be >= 1000');
  }

  if (config.dropThreshold < 0 || config.dropThreshold > 1) {
    errors.push('dropThreshold must be between 0 and 1');
  }

  if (config.maxRecallTokens < 100) {
    errors.push('maxRecallTokens must be >= 100');
  }

  return errors;
}