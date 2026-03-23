import { describe, it, expect } from 'vitest';
import {
  validateSessionId,
  validateEntityName,
  validateEntityType,
  isValidEntityType,
  escapeLikePattern,
  validateMessageContent,
  assertNonEmptyString,
  assertNonEmptyArray,
} from '../src/utils/validators.js';

describe('validators', () => {

  describe('validateSessionId', () => {
    it('should accept valid session ID', () => {
      expect(() => validateSessionId('session_abc123')).not.toThrow();
    });

    it('should reject empty string', () => {
      expect(() => validateSessionId('')).toThrow('must be a non-empty string');
    });

    it('should reject whitespace-only string', () => {
      expect(() => validateSessionId('   ')).toThrow('must be a non-empty string');
    });

    it('should reject non-string', () => {
      expect(() => validateSessionId(null as any)).toThrow('must be a non-empty string');
      expect(() => validateSessionId(undefined as any)).toThrow('must be a non-empty string');
    });

    it('should reject session ID exceeding max length', () => {
      const longId = 'a'.repeat(201);
      expect(() => validateSessionId(longId)).toThrow('exceeds max');
    });

    it('should accept session ID at max length', () => {
      const maxId = 'a'.repeat(200);
      expect(() => validateSessionId(maxId)).not.toThrow();
    });
  });

  describe('validateEntityName', () => {
    it('should accept valid entity name', () => {
      expect(() => validateEntityName('Project Alpha')).not.toThrow();
    });

    it('should reject empty string', () => {
      expect(() => validateEntityName('')).toThrow('must be a non-empty string');
    });

    it('should reject whitespace-only string', () => {
      expect(() => validateEntityName('   ')).toThrow('must be a non-empty string');
    });

    it('should reject name exceeding max length', () => {
      const longName = 'a'.repeat(501);
      expect(() => validateEntityName(longName)).toThrow('exceeds max');
    });
  });

  describe('isValidEntityType', () => {
    it('should return true for valid types', () => {
      expect(isValidEntityType('person')).toBe(true);
      expect(isValidEntityType('project')).toBe(true);
      expect(isValidEntityType('tool')).toBe(true);
      expect(isValidEntityType('concept')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(isValidEntityType('animal')).toBe(false);
      expect(isValidEntityType('')).toBe(false);
      expect(isValidEntityType('PERSON')).toBe(false);
    });
  });

  describe('validateEntityType', () => {
    it('should accept valid types', () => {
      expect(() => validateEntityType('person')).not.toThrow();
      expect(() => validateEntityType('project')).not.toThrow();
      expect(() => validateEntityType('tool')).not.toThrow();
      expect(() => validateEntityType('concept')).not.toThrow();
    });

    it('should throw for invalid type', () => {
      expect(() => validateEntityType('animal')).toThrow('Invalid entity type');
    });
  });

  describe('escapeLikePattern', () => {
    it('should escape % and _ wildcards', () => {
      expect(escapeLikePattern('100%')).toBe('100\\%');
      expect(escapeLikePattern('user_name')).toBe('user\\_name');
      expect(escapeLikePattern('a%b_c')).toBe('a\\%b\\_c');
    });

    it('should escape backslash', () => {
      expect(escapeLikePattern('path\\to')).toBe('path\\\\to');
    });

    it('should leave normal text unchanged', () => {
      expect(escapeLikePattern('hello world')).toBe('hello world');
    });

    it('should handle empty string', () => {
      expect(escapeLikePattern('')).toBe('');
    });
  });

  describe('validateMessageContent', () => {
    it('should accept valid content', () => {
      expect(() => validateMessageContent('hello')).not.toThrow();
    });

    it('should reject non-string', () => {
      expect(() => validateMessageContent(123)).toThrow('must be a string');
      expect(() => validateMessageContent(null)).toThrow('must be a string');
    });

    it('should reject content exceeding max length', () => {
      const longContent = 'a'.repeat(10_000_001);
      expect(() => validateMessageContent(longContent)).toThrow('exceeds max');
    });

    it('should accept content at max length', () => {
      const maxContent = 'a'.repeat(10_000_000);
      expect(() => validateMessageContent(maxContent)).not.toThrow();
    });
  });

  describe('assertNonEmptyString', () => {
    it('should accept non-empty string', () => {
      expect(() => assertNonEmptyString('hello', 'field')).not.toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => assertNonEmptyString('', 'field')).toThrow('Invalid field: must be a non-empty string');
    });

    it('should throw for non-string', () => {
      expect(() => assertNonEmptyString(42, 'field')).toThrow('Invalid field: must be a non-empty string');
    });
  });

  describe('assertNonEmptyArray', () => {
    it('should accept non-empty array', () => {
      expect(() => assertNonEmptyArray([1, 2], 'field')).not.toThrow();
    });

    it('should throw for empty array', () => {
      expect(() => assertNonEmptyArray([], 'field')).toThrow('Invalid field: must be a non-empty array');
    });

    it('should throw for non-array', () => {
      expect(() => assertNonEmptyArray('not-array', 'field')).toThrow('must be a non-empty array');
    });
  });
});
