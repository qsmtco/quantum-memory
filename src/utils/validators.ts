/**
 * Quantum Memory - Input Validation Utilities
 * 
 * Centralized validation for external inputs at public API boundaries.
 * Prevents invalid data from reaching the database or causing unexpected behavior.
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 6 (Input Validation)
 */

import type { EntityType } from './EntityExtractor.js';

// Valid entity types (used to validate incoming entity type strings)
const VALID_ENTITY_TYPES: EntityType[] = ['person', 'project', 'tool', 'concept'];

// Maximum lengths to prevent resource exhaustion
const MAX_ENTITY_NAME_LENGTH = 500;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_MESSAGE_CONTENT_LENGTH = 10_000_000; // 10MB of text

/**
 * Validate that a value is a non-empty string.
 * Throws with descriptive message on failure.
 */
export function assertNonEmptyString(val: unknown, fieldName: string): asserts val is string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
  }
}

/**
 * Validate session ID format.
 * Session IDs must be non-empty strings within a reasonable length.
 */
export function validateSessionId(sessionId: string): void {
  assertNonEmptyString(sessionId, 'sessionId');
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error(`Invalid sessionId: length ${sessionId.length} exceeds max ${MAX_SESSION_ID_LENGTH}`);
  }
}

/**
 * Validate entity name.
 * Names must be non-empty, trimmed, and within max length.
 */
export function validateEntityName(name: string): void {
  assertNonEmptyString(name, 'entity name');
  const trimmed = name.trim();
  if (trimmed.length > MAX_ENTITY_NAME_LENGTH) {
    throw new Error(`Invalid entity name: length ${trimmed.length} exceeds max ${MAX_ENTITY_NAME_LENGTH}`);
  }
}

/**
 * Validate entity type.
 * Returns true if valid EntityType, false otherwise.
 */
export function isValidEntityType(type: string): type is EntityType {
  return VALID_ENTITY_TYPES.includes(type as EntityType);
}

/**
 * Validate entity type and throw on failure.
 */
export function validateEntityType(type: string): asserts type is EntityType {
  if (!isValidEntityType(type)) {
    throw new Error(`Invalid entity type: "${type}" — must be one of: ${VALID_ENTITY_TYPES.join(', ')}`);
  }
}

/**
 * Escape SQL LIKE pattern special characters.
 * Prevents wildcard injection in LIKE queries.
 */
export function escapeLikePattern(text: string): string {
  // Escape the 3 special LIKE characters: % _ \
  return text.replace(/[%_\\]/g, '\\$&');
}

/**
 * Validate message content is within acceptable bounds.
 * Prevents resource exhaustion from excessively large messages.
 */
export function validateMessageContent(content: unknown): asserts content is string {
  if (typeof content !== 'string') {
    throw new Error('Invalid message content: must be a string');
  }
  if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    throw new Error(`Invalid message content: length ${content.length} exceeds max ${MAX_MESSAGE_CONTENT_LENGTH}`);
  }
}

/**
 * Validate an array is non-empty.
 */
export function assertNonEmptyArray<T>(val: unknown, fieldName: string): asserts val is T[] {
  if (!Array.isArray(val) || val.length === 0) {
    throw new Error(`Invalid ${fieldName}: must be a non-empty array`);
  }
}
