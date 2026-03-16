# Quantum Memory - Edge Cases & Failure Modes

**Document ID:** QM-EDGE-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Edge Cases](#2-data-edge-cases)
3. [Database Edge Cases](#3-database-edge-cases)
4. [LLM Edge Cases](#4-llm-edge-cases)
5. [Concurrency Edge Cases](#5-concurrency-edge-cases)
6. [Recovery Procedures](#7-recovery-procedures)
7. [Failure Mode Summary](#8-failure-mode-summary)

---

## 1. Overview

### 1.1 Purpose

This document covers edge cases, corner cases, and failure modes that Quantum Memory may encounter. Each case includes detection, prevention strategies, and recovery procedures.

### 1.2 Edge Case Categories

| Category | Description |
|----------|-------------|
| Data | Unusual but valid data patterns |
| Database | Corruption, migrations, limits |
| LLM | Provider failures, rate limits |
| Concurrency | Race conditions, locking |
| Recovery | Crash recovery, data rescue |

---

## 2. Data Edge Cases

### 2.1 Empty Messages

**Scenario:** Message with empty content or whitespace only.

**Detection:**
```sql
SELECT id FROM messages WHERE length(trim(content)) = 0;
```

**Impact:**
- Stored but provides no value
- Increases token count without benefit

**Handling:**
```typescript
// Reject empty messages
if (message.content.trim().length === 0) {
  throw new QuantumError('Empty message content', 'VALIDATION_ERROR');
}

// Or allow but mark for low importance
message.importance_score = 0.0;
```

**Recovery:** Delete empty messages with low importance score.

---

### 2.2 Duplicate Messages

**Scenario:** Same message content appears multiple times (e.g., retry logic).

**Detection:**
```sql
SELECT content, count(*) as cnt 
FROM messages 
GROUP BY content 
HAVING cnt > 1;
```

**Impact:**
- Wastes storage
- Skews entity extraction
- Affects summarization quality

**Handling:**
```typescript
// Check for exact duplicates in recent messages
const recent = await db.getMessages(sessionId, { limit: 10 });
const isDuplicate = recent.some(m => m.content === newMessage.content);

if (isDuplicate) {
  logger.warn('Duplicate message detected', { sessionId });
  // Optionally skip or mark as duplicate
}
```

---

### 2.3 Very Long Messages

**Scenario:** Single message exceeds 100K tokens.

**Detection:**
```sql
SELECT id, length(content) as len 
FROM messages 
WHERE length(content) > 400000;
```

**Impact:**
- May exceed LLM context limits
- Slows down summarization
- Memory pressure

**Handling:**
```typescript
const MAX_MESSAGE_TOKENS = 100000;
const tokens = countTokens(message.content);

if (tokens > MAX_MESSAGE_TOKENS) {
  // Split into chunks or reject
  throw new QuantumError(
    `Message exceeds ${MAX_MESSAGE_TOKENS} tokens`, 
    'VALIDATION_ERROR'
  );
}
```

---

### 2.4 Special Characters

**Scenario:** Message contains null bytes, unicode control characters, or extremely long lines.

**Detection:**
```sql
SELECT id FROM messages 
WHERE content LIKE '%' || char(0) || '%'
   OR length(content) > 1000000;
```

**Handling:**
```typescript
// Sanitize content
function sanitizeContent(content: string): string {
  return content
    .replace(/\0/g, '')  // Remove null bytes
    .replace(/[\x00-\x1F\x7F]/g, '')  // Remove control chars
    .replace(/\n{10,}/g, '\n\n\n')   // Collapse excessive newlines
    .trim();
}
```

---

### 2.5 Binary Data

**Scenario:** Message accidentally contains base64 or binary data.

**Detection:**
```typescript
// Check for base64 patterns
const isBase64 = /^[A-Za-z0-9+/=]{100,}$/.test(content);
const isBinary = /[\x00-\x08\x0E-\x1F]/.test(content);
```

**Handling:**
```typescript
if (isBase64 || isBinary) {
  logger.warn('Binary content detected, truncating', { sessionId });
  content = '[Binary content redacted]';
}
```

---

### 2.6 Message Ordering

**Scenario:** Messages arrive out of order (clock skew, network delays).

**Impact:**
- Confused conversation flow
- Entity extraction may miss context
- Summaries may be incoherent

**Handling:**
```typescript
// Always order by created_at, not arrival order
const messages = await db.getMessages(sessionId, {
  orderBy: 'created_at',
  orderDirection: 'ASC'
});
```

---

## 3. Database Edge Cases

### 3.1 Database Corruption

**Scenario:** SQLite database becomes corrupted.

**Detection:**
```bash
quantum-memory maintenance check
# Or programmatically
pragma integrity_check;
```

**Recovery:**
```bash
# 1. Backup current DB
cp quantum.db quantum.db.corrupt

# 2. Export valid data
quantum-memory data export sess_abc123 --output backup.json

# 3. Create new DB
rm quantum.db
quantum-memory maintenance restore backup.json

# 4. If partial corruption, try:
sqlite3 quantum.db ".recover" | sqlite3 quantum.db.new
```

**Prevention:**
- WAL mode (enabled by default)
- Regular backups
- Graceful shutdowns
- Disk health monitoring

---

### 3.2 Schema Migration Failure

**Scenario:** Migration from v4 to v5 fails mid-way.

**Detection:**
```sql
SELECT * FROM schema_versions ORDER BY version DESC LIMIT 1;
-- Returns incomplete migration
```

**Recovery:**
```typescript
// Migration must be idempotent
async function migrateV5() {
  // Check if already applied
  const existing = await db.getConfig('schema_version');
  if (existing >= 5) return;
  
  // Run in transaction
  await db.transaction(async () => {
    await db.run('ALTER TABLE messages ADD COLUMN new_field TEXT');
    await db.setConfig('schema_version', '5');
  });
}
```

---

### 3.3 Disk Full

**Scenario:** Disk runs out of space during write.

**Detection:**
```typescript
// Check before write
const freeSpace = await fs.statfs(dbPath);
if (freeSpace.available < MIN_FREE_SPACE) {
  throw new QuantumError('Disk full', 'STORAGE_ERROR');
}
```

**Recovery:**
```bash
# 1. Archive old sessions
quantum-memory session archive sess_old1
quantum-memory session archive sess_old2

# 2. Run VACUUM
quantum-memory maintenance vacuum

# 3. Check WAL truncation
```

---

### 3.4 Database Lock Timeout

**Scenario:** Database locked by long-running operation.

**Detection:**
```sql
-- SQLite error: SQLITE_BUSY
```

**Recovery:**
```typescript
// Retry with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 'SQLITE_BUSY' && i < retries - 1) {
        await sleep(Math.pow(2, i) * 100);
        continue;
      }
      throw error;
    }
  }
}
```

---

### 3.5 Very Large Database

**Scenario:** Database exceeds 10GB.

**Impact:**
- Slower queries
- Backup takes long
- Disk pressure

**Mitigation:**
```json
{
  "quantumMemory": {
    "alerts": {
      "db_size_warning_gb": 5,
      "db_size_critical_gb": 10
    }
  }
}
```

**Recovery:**
- Archive old sessions
- Export to cold storage
- Run VACUUM
- Consider splitting into multiple databases

---

### 3.6 Index Corruption

**Scenario:** Index becomes inconsistent with data.

**Detection:**
```bash
quantum-memory maintenance check
# Shows index issues
```

**Recovery:**
```bash
quantum-memory maintenance rebuild-indexes
```

---

## 4. LLM Edge Cases

### 4.1 LLM Provider Unavailable

**Scenario:** Cannot reach LLM provider (network issue, downtime).

**Detection:**
```typescript
try {
  await llm.complete(prompt);
} catch (error) {
  if (error.code === 'NETWORK_ERROR' || error.status === 503) {
    // Fallback
  }
}
```

**Recovery - Extractive Summarization:**
```typescript
async function summarizeExtractive(messages: Message[]): string {
  // Take first and last messages, plus key sentences
  const text = messages.map(m => m.content).join('\n');
  const sentences = text.split(/[.!?]+/).filter(s => s.trim());
  
  // Take every Nth sentence
  const step = Math.ceil(sentences.length / 20);
  return sentences
    .filter((_, i) => i % step === 0)
    .join('. ') + '.';
}
```

---

### 4.2 Rate Limiting

**Scenario:** LLM provider returns 429 (Too Many Requests).

**Detection:**
```typescript
if (error.status === 429) {
  const retryAfter = error.headers['retry-after'] || 60;
  // Wait and retry
}
```

**Recovery:**
```typescript
async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        const delay = (error.retryAfter || 60) * 1000;
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}
```

---

### 4.3 LLM Returns Malformed Output

**Scenario:** LLM returns invalid JSON or incomplete summary.

**Detection:**
```typescript
try {
  JSON.parse(llmOutput);
} catch {
  // Malformed
}
```

**Recovery:**
```typescript
async function safeSummarize(messages: Message[]): Promise<string> {
  try {
    return await llm.summarize(messages);
  } catch (error) {
    logger.error('LLM summarization failed, using extractive', { error });
    return extractiveSummarize(messages);
  }
}
```

---

### 4.4 Context Window Exceeded

**Scenario:** Messages to summarize exceed LLM context window.

**Detection:**
```typescript
const tokens = countTokens(messages);
if (tokens > MAX_CONTEXT_TOKENS) {
  // Split into chunks
}
```

**Recovery:**
```typescript
async function chunkedSummarize(messages: Message[]): Promise<string> {
  const MAX_TOKENS = 15000;  // Leave room for prompt
  
  let chunks = [];
  let currentChunk = [];
  let currentTokens = 0;
  
  for (const msg of messages) {
    const msgTokens = countTokens(msg.content);
    if (currentTokens + msgTokens > MAX_TOKENS) {
      chunks.push(currentChunk);
      currentChunk = [msg];
      currentTokens = msgTokens;
    } else {
      currentChunk.push(msg);
      currentTokens += msgTokens;
    }
  }
  if (currentChunk.length) chunks.push(currentChunk);
  
  // Summarize each chunk, then summarize summaries
  const chunkSummaries = await Promise.all(
    chunks.map(chunk => llm.summarize(chunk))
  );
  
  return llm.summarize(chunkSummaries);
}
```

---

### 4.5 Expensive LLM Model

**Scenario:** Configured model is too expensive for production.

**Detection:**
```typescript
const model = config.llm?.model || 'gpt-4';
const expensiveModels = ['gpt-4', 'claude-3-opus'];

if (expensiveModels.includes(model) && !config.llm?.allowExpensive) {
  logger.warn('Using expensive model in production', { model });
}
```

**Recovery:**
```json
{
  "quantumMemory": {
    "llm": {
      "model": "gpt-3.5-turbo",
      "allowExpensive": false
    }
  }
}
```

---

## 5. Concurrency Edge Cases

### 5.1 Concurrent Session Access

**Scenario:** Same session accessed by multiple requests.

**Detection:**
```sql
-- Check for active locks
PRAGMA database_list;
```

**Recovery:**
```typescript
// Use write-ahead logging (WAL) mode
this.db.pragma('journal_mode = WAL');

// Enable busy timeout
this.db.pragma('busy_timeout = 5000');

// Serialize writes
await this.writeLock.wait();
try {
  await this.storeInternal(context);
} finally {
  this.writeLock.release();
}
```

---

### 5.2 Compaction Race Condition

**Scenario:** Two compaction jobs triggered simultaneously.

**Prevention:**
```typescript
// Use mutex for compaction
const compactionLock = new Mutex();

async function maybeCompact(sessionId: string) {
  return compactionLock.runExclusive(async () => {
    // Check if already compacting
    const status = await db.getSessionStatus(sessionId);
    if (status.compacting) return;
    
    await db.setCompacting(sessionId, true);
    try {
      await doCompaction(sessionId);
    } finally {
      await db.setCompacting(sessionId, false);
    }
  });
}
```

---

### 5.3 Entity Extraction Race

**Scenario:** Same entity extracted concurrently from different messages.

**Prevention:**
```typescript
// Use upsert with conflict resolution
await db.run(`
  INSERT INTO entities (id, session_id, name, type, mention_count)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(id) DO UPDATE SET
    mention_count = mention_count + 1,
    last_seen = datetime('now')
`, [id, sessionId, name, type]);
```

---

## 6. Recovery Procedures

### 6.1 Crash Recovery

**Scenario:** Process crashes during write.

**Recovery (WAL):**
```bash
# WAL mode ensures committed writes are safe
# On restart, SQLite replays WAL
# If checkpoint needed:
sqlite3 quantum.db "PRAGMA wal_checkpoint(TRUNCATE)"
```

**Recovery (Manual):**
```bash
# Check for partial writes
quantum-memory maintenance check

# If issues found:
# 1. Backup
cp quantum.db quantum.db.backup

# 2. Recover
sqlite3 quantum.db ".recover" > recovery.sql
sqlite3 quantum.db.new < recovery.sql
mv quantum.db.new quantum.db
```

---

### 6.2 Session Recovery

**Scenario:** Session in inconsistent state after crash.

**Detection:**
```sql
SELECT * FROM sessions 
WHERE status = 'active' 
AND ended_at IS NULL 
AND datetime(started_at) < datetime('now', '-1 day');
```

**Recovery:**
```typescript
async function recoverSession(sessionId: string) {
  // Check message count
  const msgCount = await db.countMessages(sessionId);
  
  // Check if DAG is consistent
  const summaryCount = await db.countSummaries(sessionId);
  
  if (summaryCount === 0 && msgCount > 100) {
    // Needs compaction
    await compact(sessionId);
  }
  
  // Mark as recovered
  await db.updateSession(sessionId, { 
    status: 'completed',
    metadata: JSON.stringify({ recovered: true })
  });
}
```

---

### 6.3 Orphaned Data

**Scenario:** Messages without valid session reference.

**Detection:**
```sql
SELECT m.id FROM messages m
LEFT JOIN sessions s ON m.session_id = s.id
WHERE s.id IS NULL;
```

**Recovery:**
```sql
-- Archive orphaned messages
CREATE TABLE messages_archive AS
SELECT m.* FROM messages m
LEFT JOIN sessions s ON m.session_id = s.id
WHERE s.id IS NULL;

DELETE FROM messages 
WHERE id IN (SELECT id FROM messages_archive);
```

---

## 7. Failure Mode Summary

| Failure Mode | Detection | Impact | Recovery Time |
|--------------|-----------|--------|---------------|
| DB corruption | integrity_check | Full system | Hours |
| Disk full | statfs | Writes fail | Minutes |
| LLM unavailable | Network error | Compaction pauses | Minutes to hours |
| Rate limited | 429 response | Compaction slows | Minutes |
| Race condition | Lock timeout | Requests fail | Seconds |
| Orphaned data | SQL query | Wasted storage | Minutes |

---

## 8. Prevention Checklist

- [ ] WAL mode enabled
- [ ] Regular backups
- [ ] Disk space monitoring
- [ ] LLM fallback configured
- [ ] Rate limit handling
- [ ] Write locks implemented
- [ ] Migration transactions
- [ ] Health checks enabled

---

**End of Edge Cases Documentation**

*Document prepared for Quantum Memory implementation*
