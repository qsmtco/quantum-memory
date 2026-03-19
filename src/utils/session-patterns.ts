/**
 * Session Pattern Matching Utility
 * 
 * Compiles glob patterns for session key matching.
 * Used to filter which sessions get stored/ignored.
 * 
 * Pattern rules:
 * - `*` matches any non-colon characters
 * - `**` can span colons (full wildcard)
 * 
 * @example
 * compileSessionPattern("heartbeat:*") // matches "heartbeat:main", "heartbeat:cron"
 * compileSessionPattern("agent:*")    // matches "agent:subagent:123"
 */

 /**
 * Compile a session glob into a regex.
 * 
 * `*` matches any non-colon characters, while `**` can span colons.
 */
export function compileSessionPattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^:]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Compile all configured ignore patterns once at startup.
 */
export function compileSessionPatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => compileSessionPattern(pattern));
}

/**
 * Check whether a session key matches any compiled pattern.
 */
export function matchesSessionPattern(sessionKey: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sessionKey));
}
