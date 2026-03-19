/**
 * Quantum Memory - Configuration Resolution
 * 
 * Three-tier config precedence:
 *   1. Environment variables (QM_* prefix)
 *   2. Plugin config (from openclaw.plugin.json)
 *   3. Default values
 * 
 * @see https://github.com/qsmtco/quantum-memory
 */

import { homedir } from "os";
import { join } from "path";

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Complete Quantum Memory configuration interface
 * Matches openclaw.plugin.json configSchema
 */
export interface QuantumMemoryConfig {
  // Core settings
  enabled: boolean;
  databasePath: string;
  
  // Compaction settings
  contextThreshold: number;
  freshTailCount: number;
  leafChunkTokens: number;
  leafTargetTokens: number;
  condensedTargetTokens: number;
  
  // Model overrides
  summaryModel?: string;
  summaryProvider?: string;
  expansionModel?: string;
  expansionProvider?: string;
  
  // Session patterns
  ignoreSessionPatterns: string[];
  statelessSessionPatterns: string[];
  skipStatelessSessions: boolean;
  
  // Feature flags
  entityExtractionEnabled: boolean;
  knowledgeGraphEnabled: boolean;
  autoRecallEnabled: boolean;
  autoRecallBudget: "low" | "mid" | "high";
  smartDropEnabled: boolean;
  
  // Large file handling
  largeFileEnabled: boolean;
  largeFileThreshold: number;
  largeFileSummaryModel?: string;
  largeFileSummaryProvider?: string;
  largeFileMaxParallel: number;
}

/**
 * Default configuration values
 */
const DEFAULTS: QuantumMemoryConfig = {
  enabled: true,
  databasePath: "~/.openclaw/quantum.db",
  contextThreshold: 0.75,
  freshTailCount: 32,
  leafChunkTokens: 20000,
  leafTargetTokens: 1200,
  condensedTargetTokens: 2000,
  summaryModel: undefined,
  summaryProvider: undefined,
  expansionModel: undefined,
  expansionProvider: undefined,
  ignoreSessionPatterns: [],
  statelessSessionPatterns: [],
  skipStatelessSessions: true,
  entityExtractionEnabled: true,
  knowledgeGraphEnabled: true,
  autoRecallEnabled: true,
  autoRecallBudget: "mid",
  smartDropEnabled: true,
  // Large file handling defaults
  largeFileEnabled: true,
  largeFileThreshold: 25000,
  largeFileSummaryModel: undefined,
  largeFileSummaryProvider: undefined,
  largeFileMaxParallel: 5,
};

/**
 * Environment variable prefix for Quantum Memory
 */
const ENV_PREFIX = "QM_";

/**
 * Safely coerce unknown value to finite number
 */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Safely coerce unknown value to boolean
 */
function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Safely coerce unknown value to trimmed string
 */
function toStr(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/**
 * Coerce value to string array
 */
function toStrArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => toStr(v))
      .filter((v): v is string => typeof v === "string");
  }
  const single = toStr(value);
  if (!single) return [];
  return single.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve config from three-tier precedence:
 * 1. Environment variables (QM_*)
 * 2. Plugin config (openclaw.plugin.json)
 * 3. Default values
 */
export function resolveQuantumMemoryConfig(
  pluginConfig: Record<string, unknown> = {}
): QuantumMemoryConfig {
  const env = process.env;
  
  // Helper to get env var with QM_ prefix
  const getEnv = (key: string): string | undefined => {
    return env[ENV_PREFIX + key];
  };

  // Build config with precedence: env > plugin > defaults
  const config: QuantumMemoryConfig = {
    // Core
    enabled: toBool(pluginConfig.enabled ?? getEnv("ENABLED"), DEFAULTS.enabled),
    databasePath: toStr(pluginConfig.databasePath ?? getEnv("DATABASE_PATH")) 
      ?? expandPath(DEFAULTS.databasePath),
    
    // Compaction
    contextThreshold: toNumber(
      pluginConfig.contextThreshold ?? getEnv("CONTEXT_THRESHOLD"),
      DEFAULTS.contextThreshold
    ),
    freshTailCount: toNumber(
      pluginConfig.freshTailCount ?? getEnv("FRESH_TAIL_COUNT"),
      DEFAULTS.freshTailCount
    ),
    leafChunkTokens: toNumber(
      pluginConfig.leafChunkTokens ?? getEnv("LEAF_CHUNK_TOKENS"),
      DEFAULTS.leafChunkTokens
    ),
    leafTargetTokens: toNumber(
      pluginConfig.leafTargetTokens ?? getEnv("LEAF_TARGET_TOKENS"),
      DEFAULTS.leafTargetTokens
    ),
    condensedTargetTokens: toNumber(
      pluginConfig.condensedTargetTokens ?? getEnv("CONDENSED_TARGET_TOKENS"),
      DEFAULTS.condensedTargetTokens
    ),
    
    // Model overrides
    summaryModel: toStr(pluginConfig.summaryModel ?? getEnv("SUMMARY_MODEL")),
    summaryProvider: toStr(pluginConfig.summaryProvider ?? getEnv("SUMMARY_PROVIDER")),
    expansionModel: toStr(pluginConfig.expansionModel ?? getEnv("EXPANSION_MODEL")),
    expansionProvider: toStr(pluginConfig.expansionProvider ?? getEnv("EXPANSION_PROVIDER")),
    
    // Session patterns
    ignoreSessionPatterns: toStrArray(
      pluginConfig.ignoreSessionPatterns ?? getEnv("IGNORE_SESSION_PATTERNS")
    ),
    statelessSessionPatterns: toStrArray(
      pluginConfig.statelessSessionPatterns ?? getEnv("STATELESS_SESSION_PATTERNS")
    ),
    skipStatelessSessions: toBool(
      pluginConfig.skipStatelessSessions ?? getEnv("SKIP_STATELESS_SESSIONS"),
      DEFAULTS.skipStatelessSessions
    ),
    
    // Feature flags
    entityExtractionEnabled: toBool(
      pluginConfig.entityExtractionEnabled ?? getEnv("ENTITY_EXTRACTION_ENABLED"),
      DEFAULTS.entityExtractionEnabled
    ),
    knowledgeGraphEnabled: toBool(
      pluginConfig.knowledgeGraphEnabled ?? getEnv("KNOWLEDGE_GRAPH_ENABLED"),
      DEFAULTS.knowledgeGraphEnabled
    ),
    autoRecallEnabled: toBool(
      pluginConfig.autoRecallEnabled ?? getEnv("AUTO_RECALL_ENABLED"),
      DEFAULTS.autoRecallEnabled
    ),
    autoRecallBudget: (() => {
      const budget = toStr(pluginConfig.autoRecallBudget ?? getEnv("AUTO_RECALL_BUDGET"));
      if (budget === "low" || budget === "mid" || budget === "high") return budget;
      return DEFAULTS.autoRecallBudget;
    })(),
    smartDropEnabled: toBool(
      pluginConfig.smartDropEnabled ?? getEnv("SMART_DROP_ENABLED"),
      DEFAULTS.smartDropEnabled
    ),
    // Large file handling
    largeFileEnabled: toBool(
      pluginConfig.largeFileEnabled ?? getEnv("LARGE_FILE_ENABLED"),
      DEFAULTS.largeFileEnabled
    ),
    largeFileThreshold: toNumber(
      pluginConfig.largeFileThreshold ?? getEnv("LARGE_FILE_THRESHOLD"),
      DEFAULTS.largeFileThreshold
    ),
    largeFileSummaryModel: toStr(pluginConfig.largeFileSummaryModel ?? getEnv("LARGE_FILE_SUMMARY_MODEL")),
    largeFileSummaryProvider: toStr(pluginConfig.largeFileSummaryProvider ?? getEnv("LARGE_FILE_SUMMARY_PROVIDER")),
    largeFileMaxParallel: toNumber(
      pluginConfig.largeFileMaxParallel ?? getEnv("LARGE_FILE_MAX_PARALLEL"),
      DEFAULTS.largeFileMaxParallel
    ),
  };

  return config;
}

/**
 * Get default config (no env/plugin override)
 */
export function getDefaultConfig(): QuantumMemoryConfig {
  return { ...DEFAULTS };
}
