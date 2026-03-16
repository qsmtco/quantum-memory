import { describe, it, expect } from 'vitest';
import { resolveQuantumConfig, validateQuantumConfig } from '../src/utils/config.js';

describe('Config Utils', () => {
  describe('resolveQuantumConfig', () => {
    it('should return default config with no OpenClaw config', () => {
      const result = resolveQuantumConfig({});
      expect(result.databasePath).toBe('~/.openclaw/quantum.db');
      expect(result.freshTailCount).toBe(32);
      expect(result.contextThreshold).toBe(0.75);
    });

    it('should merge plugin config with defaults', () => {
      const openclawConfig = {
        plugins: {
          entries: {
            'quantum-memory': {
              config: {
                freshTailCount: 50,
                contextThreshold: 0.8,
              },
            },
          },
        },
      };
      
      const result = resolveQuantumConfig(openclawConfig);
      expect(result.freshTailCount).toBe(50);
      expect(result.contextThreshold).toBe(0.8);
      expect(result.databasePath).toBe('~/.openclaw/quantum.db');
    });

    it('should expand tilde paths', () => {
      const openclawConfig = {
        plugins: {
          entries: {
            'quantum-memory': {
              config: {
                databasePath: '~/custom.db',
              },
            },
          },
        },
      };
      
      const result = resolveQuantumConfig(openclawConfig);
      // Check that tilde was expanded (ends with .db, not ~/custom.db)
      expect(result.databasePath).toMatch(/.*\.db$/);
      expect(result.databasePath).not.toContain('~/');
    });
  });

  describe('validateQuantumConfig', () => {
    it('should return no errors for valid config', () => {
      const config = {
        freshTailCount: 32,
        contextThreshold: 0.75,
        leafChunkTokens: 20000,
        leafTargetTokens: 1200,
      };
      
      const errors = validateQuantumConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should detect invalid freshTailCount', () => {
      const config = {
        freshTailCount: -1,
        contextThreshold: 0.75,
      };
      
      const errors = validateQuantumConfig(config);
      expect(errors).toContain('freshTailCount must be >= 0');
    });

    it('should detect invalid contextThreshold', () => {
      const config = {
        freshTailCount: 32,
        contextThreshold: 1.5,
      };
      
      const errors = validateQuantumConfig(config);
      expect(errors).toContain('contextThreshold must be between 0 and 1');
    });

    it('should detect invalid leafChunkTokens', () => {
      const config = {
        freshTailCount: 32,
        contextThreshold: 0.75,
        leafChunkTokens: 500,
      };
      
      const errors = validateQuantumConfig(config);
      expect(errors).toContain('leafChunkTokens must be >= 1000');
    });

    it('should detect multiple errors', () => {
      const config = {
        freshTailCount: -1,
        contextThreshold: 1.5,
        leafChunkTokens: 500,
        leafTargetTokens: 50,
      };
      
      const errors = validateQuantumConfig(config);
      expect(errors.length).toBeGreaterThan(1);
      expect(errors).toContain('freshTailCount must be >= 0');
      expect(errors).toContain('contextThreshold must be between 0 and 1');
      expect(errors).toContain('leafChunkTokens must be >= 1000');
      expect(errors).toContain('leafTargetTokens must be >= 100');
    });
  });
});
