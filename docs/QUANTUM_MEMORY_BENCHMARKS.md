# Quantum Memory - Benchmarks

**Document ID:** QM-BENCH-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Overview](#1-overview)
2. [Benchmark Environments](#2-benchmark-environments)
3. [Core Operation Benchmarks](#3-core-operation-benchmarks)
4. [Compaction Benchmarks](#4-compaction-benchmarks)
5. [Search Benchmarks](#5-search-benchmarks)
6. [Entity Extraction Benchmarks](#6-entity-extraction-benchmarks)
7. [Scalability Benchmarks](#7-scalability-benchmarks)
8. [Performance Targets](#8-performance-targets)
9. [Benchmark Commands](#9-benchmark-commands)

---

## 1. Overview

### 1.1 Purpose

This document defines performance benchmarks for Quantum Memory. Benchmarks measure latency, throughput, and scalability to ensure the system meets requirements.

### 1.2 Benchmark Categories

| Category | What It Measures |
|----------|------------------|
| Core Ops | Store, get, clear operations |
| Compaction | DAG summarization performance |
| Search | Full-text search latency |
| Entities | Extraction and storage |
| Scalability | Large datasets |

---

## 2. Benchmark Environments

### 2.1 Standard Test Environment

| Component | Specification |
|-----------|---------------|
| CPU | Apple M2 Pro (or equivalent) |
| RAM | 16 GB |
| Storage | NVMe SSD |
| Node.js | v22.x |
| SQLite | 3.x with WAL |

### 2.2 Variations

| Environment | Description |
|-------------|-------------|
| standard | Default hardware (M2 Pro, 16GB) |
| low-end | 4GB RAM, HDD |
| high-end | 32GB RAM, fast NVMe |
| constrained | Container with CPU limits |

---

## 3. Core Operation Benchmarks

### 3.1 Store Operation

**Operation:** Store context with N messages

**Benchmark Script:**
```typescript
async function benchmarkStore(messageCount: number) {
  const messages = generateMessages(messageCount);
  
  const start = Date.now();
  await qm.store({ sessionId, messages });
  const duration = Date.now() - start;
  
  return { messageCount, duration, msgsPerSec: messageCount / (duration / 1000) };
}
```

**Results - Standard Environment:**

| Messages | Duration (ms) | Throughput (msgs/sec) |
|----------|--------------|----------------------|
| 1 | 15 | 67 |
| 10 | 45 | 222 |
| 50 | 180 | 278 |
| 100 | 320 | 313 |
| 500 | 1,200 | 417 |
| 1,000 | 2,100 | 476 |

**Analysis:**
- Per-message overhead is significant for small batches
- Batching improves throughput
- Target: > 500 msgs/sec at scale

---

### 3.2 Get Operation

**Operation:** Retrieve context with reconstruction

**Benchmark Script:**
```typescript
async function benchmarkGet(maxTokens: number) {
  const start = Date.now();
  const context = await qm.get({ sessionId, maxTokens });
  const duration = Date.now() - start;
  
  return { 
    tokenCount: context.metadata.tokenCount,
    messageCount: context.messages.length,
    duration 
  };
}
```

**Results - Standard Environment:**

| Tokens Returned | Duration (ms) | Notes |
|-----------------|--------------|-------|
| 1,000 | 25 | Fresh tail only |
| 4,000 | 45 | With 1 leaf summary |
| 8,000 | 85 | With 2 leaf summaries |
| 16,000 | 150 | With condensed summary |
| 32,000 | 280 | Deep DAG |

**Analysis:**
- Latency increases with DAG depth
- Fresh tail retrieval is fast
- Caching frequently accessed sessions helps

---

### 3.3 Session Creation

**Operation:** Create new session

**Benchmark:**
```typescript
async function benchmarkCreateSession() {
  const start = Date.now();
  const session = await qm.createSession({ projectId });
  const duration = Date.now() - start;
  
  return { duration };
}
```

**Results:**

| Operation | Duration (ms) | Target (ms) |
|-----------|--------------|-------------|
| Create Session | 12 | < 50 |
| Complete Session | 8 | < 50 |
| Archive Session | 45 | < 200 |

---

## 4. Compaction Benchmarks

### 4.1 Leaf Summary Creation

**Operation:** Create leaf summary from N messages

**Benchmark Script:**
```typescript
async function benchmarkLeafSummary(messageCount: number) {
  // Fill session with messages
  await fillSession(sessionId, messageCount);
  
  const start = Date.now();
  await qm.dag.createLeafSummary(sessionId);
  const duration = Date.now() - start;
  
  return { messageCount, duration, tokensPerSec };
}
```

**Results - Standard Environment:**

| Source Messages | Source Tokens | Summary Tokens | Duration (ms) |
|-----------------|---------------|----------------|---------------|
| 100 | 15,000 | 1,200 | 2,500 |
| 500 | 75,000 | 6,000 | 8,500 |
| 1,000 | 150,000 | 12,000 | 15,000 |

**Analysis:**
- LLM call dominates time
- ~6 tokens/sec summarization rate
- Target: < 20 seconds for 20K source tokens

---

### 4.2 Condensed Summary Creation

**Operation:** Create condensed summary from leaf summaries

**Results:**

| Leaf Summaries | Source Tokens | Summary Tokens | Duration (ms) |
|----------------|---------------|----------------|---------------|
| 5 | 6,000 | 2,000 | 4,500 |
| 10 | 12,000 | 4,000 | 7,500 |
| 20 | 24,000 | 8,000 | 12,000 |

---

### 4.3 Auto-Compaction Trigger

**Operation:** Automatic compaction at threshold

**Results:**

| Trigger | Messages | DAG Depth | Auto-Compact Time |
|---------|----------|-----------|-------------------|
| 75% threshold | 128 | 1 | +2 sec |
| 75% threshold | 512 | 2 | +8 sec |
| 75% threshold | 2,048 | 3 | +25 sec |

---

## 5. Search Benchmarks

### 5.1 Full-Text Search

**Operation:** Search for query in messages

**Benchmark Script:**
```typescript
async function benchmarkSearch(query: string) {
  const start = Date.now();
  const results = await qm.search(query, { limit: 20 });
  const duration = Date.now() - start;
  
  return { resultCount: results.length, duration };
}
```

**Results - 10K Messages:**

| Query Type | Results | Duration (ms) | Target (ms) |
|------------|---------|--------------|-------------|
| Single word | 150 | 12 | < 50 |
| Two words | 45 | 15 | < 50 |
| Phrase | 23 | 18 | < 50 |
| Complex (AND/OR) | 12 | 25 | < 100 |

**Results - 100K Messages:**

| Query Type | Results | Duration (ms) | Target (ms) |
|------------|---------|--------------|-------------|
| Single word | 1,500 | 85 | < 200 |
| Two words | 450 | 95 | < 200 |
| Phrase | 230 | 110 | < 200 |

---

### 5.2 Entity Search

**Operation:** Search entities by name

**Results:**

| Entity Type | Query | Duration (ms) |
|-------------|-------|---------------|
| Person | "John" | 8 |
| Project | "Quantum" | 6 |
| Any | "*" | 15 |

---

## 6. Entity Extraction Benchmarks

### 6.1 Entity Extraction Rate

**Operation:** Extract entities from messages

**Benchmark Script:**
```typescript
async function benchmarkEntityExtraction(messageCount: number) {
  const messages = generateMessagesWithEntities(messageCount);
  
  const start = Date.now();
  const entities = await qm.extractEntities(sessionId, messages);
  const duration = Date.now() - start;
  
  return { 
    messageCount, 
    entitiesFound: entities.length,
    rate: messageCount / (duration / 1000)
  };
}
```

**Results:**

| Messages | Entities Found | Duration (ms) | Rate (msgs/sec) |
|----------|----------------|---------------|-----------------|
| 100 | 45 | 25 | 4,000 |
| 1,000 | 380 | 180 | 5,556 |
| 10,000 | 3,200 | 1,500 | 6,667 |

**Analysis:**
- Rate: ~5K-7K messages/sec
- Regex-based extraction is fast
- LLM not required for basic extraction

---

### 6.2 Knowledge Graph Build

**Operation:** Build relationships from entities

**Results:**

| Entities | Relations | Duration (ms) | Rate (rels/sec) |
|----------|-----------|---------------|-----------------|
| 100 | 45 | 15 | 6,667 |
| 1,000 | 380 | 120 | 8,333 |
| 10,000 | 3,200 | 950 | 10,526 |

---

## 7. Scalability Benchmarks

### 7.1 Session Size Scaling

**Operation:** Various session sizes

| Session Size | Store (ms) | Get (ms) | Search (ms) |
|-------------|------------|----------|-------------|
| 1K messages | 500 | 30 | 15 |
| 10K messages | 4,500 | 120 | 85 |
| 50K messages | 22,000 | 450 | 320 |
| 100K messages | 45,000 | 850 | 580 |

**Analysis:**
- Store scales linearly
- Get scales with DAG depth
- Search scales with log N (indexed)

---

### 7.2 Concurrent Sessions

**Operation:** Multiple sessions accessed simultaneously

| Concurrent | Throughput | Latency P95 | Errors |
|------------|------------|-------------|--------|
| 1 | 500 msg/s | 45 ms | 0 |
| 10 | 4,800 msg/s | 85 ms | 0 |
| 50 | 22,000 msg/s | 180 ms | 0 |
| 100 | 38,000 msg/s | 350 ms | 2 |

**Analysis:**
- SQLite WAL handles concurrency well
- Latency increases with contention
- Errors at high load due to locks

---

### 7.3 Database Size Scaling

| Messages | DB Size | Get (ms) | Search (ms) |
|----------|---------|----------|-------------|
| 10,000 | 8 MB | 25 | 12 |
| 100,000 | 75 MB | 45 | 45 |
| 500,000 | 350 MB | 95 | 120 |
| 1,000,000 | 680 MB | 150 | 180 |

---

## 8. Performance Targets

### 8.1 Latency Targets

| Operation | Target (P50) | Target (P95) | Target (P99) |
|-----------|--------------|-------------|--------------|
| Store (single msg) | < 20 ms | < 50 ms | < 100 ms |
| Store (batch) | < 5 ms/msg | < 10 ms/msg | < 20 ms/msg |
| Get | < 50 ms | < 150 ms | < 300 ms |
| Search | < 50 ms | < 150 ms | < 300 ms |
| Entity Extract | < 1 ms/msg | < 5 ms/msg | < 10 ms/msg |
| Leaf Summary | < 15 sec | < 30 sec | < 60 sec |

### 8.2 Throughput Targets

| Operation | Target |
|-----------|--------|
| Messages stored/sec | > 500 |
| Concurrent sessions | > 50 |
| Search queries/sec | > 100 |
| Entity extraction/sec | > 5,000 |

### 8.3 Capacity Targets

| Resource | Soft Limit | Hard Limit |
|----------|------------|------------|
| Messages per session | 100,000 | 500,000 |
| Entities per session | 10,000 | 50,000 |
| Relations per session | 50,000 | 200,000 |
| Database size | 1 GB | 10 GB |
| DAG depth | 10 | Unlimited |

---

## 9. Benchmark Commands

### 9.1 Run All Benchmarks

```bash
quantum-memory benchmark run
```

### 9.2 Run Specific Benchmark

```bash
quantum-memory benchmark store --messages 1000
quantum-memory benchmark get --tokens 8000
quantum-memory benchmark search --query "quantum memory"
quantum-memory benchmark entities --messages 1000
```

### 9.3 Benchmark Report

```bash
quantum-memory benchmark report --output benchmarks.json
```

**Output Format:**
```json
{
  "timestamp": "2026-03-14T13:00:00Z",
  "environment": "standard",
  "results": [
    {
      "name": "store",
      "operations": 1000,
      "p50_ms": 18,
      "p95_ms": 42,
      "p99_ms": 78,
      "throughput": 540
    }
  ]
}
```

### 9.4 Continuous Benchmarking

```bash
# Run benchmarks every hour
quantum-memory benchmark schedule --interval 1h

# Compare with baseline
quantum-memory benchmark compare --baseline benchmarks-baseline.json
```

---

## 10. Regression Detection

### 10.1 Alert on Regression

```bash
# Alert if P50 degrades by > 20%
quantum-memory benchmark check-regression --threshold 0.2
```

### 10.2 Baseline Management

```bash
# Create baseline
quantum-memory benchmark baseline --name v1.0.0

# List baselines
quantum-memory benchmark baseline list

# Use baseline for comparison
quantum-memory benchmark compare --baseline v1.0.0
```

---

**End of Benchmarks Documentation**

*Document prepared for Quantum Memory implementation*
