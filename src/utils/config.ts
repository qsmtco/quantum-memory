import { homedir } from 'os';
import { join } from 'path';

export interface QuantumConfig {
  databasePath: string;
  freshTailCount: number;
  contextThreshold: number;
  leafChunkTokens: number;
  leafTargetTokens: number;
  condensedTargetTokens: number;
}

const DEFAULT_CONFIG: QuantumConfig = {
  databasePath: '~/.openclaw/quantum.db',
  freshTailCount: 32,
  contextThreshold: 0.75,
  leafChunkTokens: 20000,
  leafTargetTokens: 1200,
  condensedTargetTokens: 2000,
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
  
  return {
    ...DEFAULT_CONFIG,
    ...pluginConfig,
    databasePath: pluginConfig.databasePath ? expandPath(pluginConfig.databasePath) : DEFAULT_CONFIG.databasePath,
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
  
  return errors;
}