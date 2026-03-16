# Quantum Memory - Observability

**Document ID:** QM-OBS-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Overview](#1-overview)
2. [Health Checks](#2-health-checks)
3. [Metrics](#3-metrics)
4. [Logging](#4-logging)
5. [Tracing](#5-tracing)
6. [Alerting](#6-alerting)
7. [Diagnostics](#7-diagnostics)

---

## 1. Overview

### 1.1 Purpose

Observability provides visibility into Quantum Memory's internal state, performance, and health. This enables operators to monitor the system, diagnose issues, and ensure reliable operation.

### 1.2 Observability Stack

| Component | Implementation |
|-----------|----------------|
| Health | Built-in HTTP endpoint |
| Metrics | In-memory + export to Prometheus |
| Logging | OpenClaw logger integration |
| Tracing | OpenTelemetry optional integration |
| Alerting | Threshold-based + anomaly detection |

---

## 2. Health Checks

### 2.1 Health Endpoint

```bash
GET /health?component=quantum-memory
```

**Response:**
```json
{
  "status": "healthy",
  "component": "quantum-memory",
  "timestamp": "2026-03-14T13:00:00Z",
  "checks": {
    "database": "ok",
    "disk_space": "ok",
    "llm_provider": "ok"
  },
  "details": {
    "db_path": "~/.openclaw/quantum.db",
    "db_size_mb": 45.2,
    "session_count": 156,
    "active_sessions": 12
  }
}
```

### 2.2 Health Check Types

#### Database Health

```bash
GET /health?component=quantum-memory&check=database
```

Checks:
- Database file exists and is readable
- SQLite connection can be established
- Schema version is current
- All tables accessible
- Foreign key integrity

**Response:**
```json
{
  "status": "ok",
  "check": "database",
  "message": "All checks passed",
  "details": {
    "schema_version": 5,
    "tables_accessible": 9,
    "indexes_valid": 11,
    "foreign_keys_ok": true
  }
}
```

#### Disk Space Health

```bash
GET /health?component=quantum-memory&check=disk
```

Checks:
- Database file size
- WAL file size
- Available disk space

**Thresholds:**
| Level | Database Size | Disk Free |
|-------|--------------|-----------|
| ok | < 1 GB | > 1 GB |
| warn | 1-5 GB | 100 MB - 1 GB |
| critical | > 5 GB | < 100 MB |

#### LLM Provider Health

```bash
GET /health?component=quantum-memory&check=llm
```

Checks:
- LLM provider reachable
- Test summarization completes

### 2.3 Health Status Codes

| Status | Code | Description |
|--------|------|-------------|
| ok | 200 | All checks passed |
| warn | 200 | Some checks at threshold |
| error | 503 | Critical check failed |
| unknown | 500 | Could not determine status |

---

## 3. Metrics

### 3.1 Core Metrics

#### Store Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_store_duration_ms` | Histogram | Time to store context |
| `qm_store_messages_total` | Counter | Total messages stored |
| `qm_store_errors_total` | Counter | Store failures |

#### Retrieve Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_get_duration_ms` | Histogram | Time to retrieve context |
| `qm_get_messages_returned` | Histogram | Messages in retrieved context |
| `qm_get_cache_hits` | Counter | Cache hits |
| `qm_get_cache_misses` | Counter | Cache misses |

#### Compaction Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_compaction_triggers_total` | Counter | Compaction triggers |
| `qm_compaction_duration_ms` | Histogram | Time for compaction |
| `qm_compaction_messages_processed` | Histogram | Messages per compaction |
| `qm_compaction_summaries_created` | Histogram | Summaries created |

#### Entity Extraction Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_entities_extracted_total` | Counter | Total entities extracted |
| `qm_entity_types` | Gauge | Count by type |
| `qm_relations_created_total` | Counter | Total relations created |

#### Search Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_search_duration_ms` | Histogram | Search latency |
| `qm_search_results` | Histogram | Results per search |
| `qm_search_queries_total` | Counter | Total searches |

#### Session Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_sessions_active` | Gauge | Active sessions |
| `qm_sessions_total` | Counter | Total sessions created |
| `qm_messages_total` | Gauge | Total messages in DB |

#### Database Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `qm_db_size_bytes` | Gauge | Database file size |
| `qm_db_wal_size_bytes` | Gauge | WAL file size |
| `qm_db_latency_ms` | Histogram | Query latency |

### 3.2 Metrics Export

#### Prometheus Format

```bash
# Endpoint
GET /metrics?component=quantum-memory

# Output
qm_store_duration_ms_bucket{le="10"} 1234
qm_store_duration_ms_bucket{le="50"} 1567
qm_store_duration_ms_bucket{le="100"} 1890
qm_store_duration_ms_bucket{le="+Inf"} 2000
qm_store_duration_ms_sum 45678
qm_store_duration_ms_count 2000
# ... etc
```

#### JSON Format

```bash
GET /metrics?component=quantum-memory&format=json
```

### 3.3 Metrics Collection

```typescript
// In QuantumEngine
import { Registry, Counter, Histogram } from 'prom-client';

const registry = new Registry();

const storeDuration = new Histogram({
  name: 'qm_store_duration_ms',
  help: 'Time to store context',
  buckets: [10, 50, 100, 200, 500, 1000],
  registers: [registry]
});

// Record timing
storeDuration.observe(duration);
```

---

## 4. Logging

### 4.1 Log Levels

| Level | Usage |
|-------|-------|
| DEBUG | Detailed diagnostic info |
| INFO | Normal operation events |
| WARN | Degradation, non-critical issues |
| ERROR | Failures requiring attention |

### 4.2 Log Categories

| Category | Description |
|----------|-------------|
| `qm.engine` | Core engine operations |
| `qm.dag` | DAG compaction operations |
| `qm.entities` | Entity extraction |
| `qm.kg` | Knowledge graph operations |
| `qm.recall` | Auto-recall operations |
| `qm.db` | Database operations |
| `qm.search` | Search operations |
| `qm.config` | Configuration changes |

### 4.3 Structured Logging

All logs use JSON format:

```json
{
  "timestamp": "2026-03-14T13:00:00.000Z",
  "level": "info",
  "category": "qm.engine",
  "message": "Context stored successfully",
  "sessionId": "sess_abc123",
  "messagesStored": 5,
  "entitiesExtracted": 3,
  "durationMs": 45
}
```

### 4.4 Sensitive Data Handling

| Data Type | Action |
|-----------|--------|
| Message content | Logged at DEBUG only |
| Entity names | Logged at INFO |
| Session IDs | Logged at INFO |
| User identifiers | NEVER logged |
| API keys | NEVER logged |

---

## 5. Tracing

### 5.1 OpenTelemetry Integration

Quantum Memory supports OpenTelemetry for distributed tracing.

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('quantum-memory');

// Trace store operation
async function store(context: Context) {
  return tracer.startActiveSpan('qm.store', async (span) => {
    try {
      // ... store logic
      span.setAttribute('qm.session_id', context.sessionId);
      span.setAttribute('qm.messages', context.messages.length);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### 5.2 Spans

| Span | Attributes |
|------|------------|
| `qm.store` | session_id, messages_count, entities_extracted |
| `qm.get` | session_id, max_tokens, include_memories |
| `qm.compact` | session_id, level, messages_compacted |
| `qm.summarize` | session_id, level, source_count, target_tokens |
| `qm.extract_entities` | session_id, entities_found |
| `qm.search` | query, results_count, duration_ms |

### 5.3 Trace Export

```typescript
// Export to Jaeger
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const exporter = new JaegerExporter({
  endpoint: 'http://localhost:14268/api/traces'
});
```

---

## 6. Alerting

### 6.1 Alert Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| HighLatency | Store latency > 500ms | warning | Review compaction |
| VeryHighLatency | Store latency > 2s | critical | Investigate immediately |
| HighErrorRate | Error rate > 5% | warning | Check LLM provider |
| CriticalErrorRate | Error rate > 20% | critical | Page on-call |
| DiskSpaceLow | Free < 100MB | critical | Archive old sessions |
| DBSizeWarning | Size > 5GB | warning | Run VACUUM |
| DBSizeCritical | Size > 10GB | critical | Archive immediately |
| NoActiveSessions | Active = 0 > 1hr | info | Normal (off-hours) |
| CompactionStuck | Duration > 10min | critical | Kill and investigate |

### 6.2 Alert Configuration

```json
{
  "quantumMemory": {
    "alerts": {
      "enabled": true,
      "rules": {
        "high_latency_ms": 500,
        "critical_latency_ms": 2000,
        "error_rate_threshold": 0.05,
        "disk_space_mb": 100,
        "db_size_warning_gb": 5,
        "db_size_critical_gb": 10,
        "compaction_timeout_ms": 600000
      },
      "notifications": {
        "type": "webhook",
        "url": "http://alerts.example.com/webhook"
      }
    }
  }
}
```

---

## 7. Diagnostics

### 7.1 Diagnostic Commands

#### Session Diagnostics

```bash
# Get session state
quantum-memory diagnostics session <session-id>

# Output
{
  "session_id": "sess_abc123",
  "status": "active",
  "message_count": 1234,
  "compacted_count": 1000,
  "dag_depth": 2,
  "summaries": [
    { "level": 0, "count": 5, "tokens": 6000 },
    { "level": 1, "count": 1, "tokens": 2000 }
  ],
  "entities": 45,
  "relations": 89,
  "last_compaction": "2026-03-14T12:00:00Z",
  "next_compaction_threshold": 1500
}
```

#### Database Diagnostics

```bash
# Get database diagnostics
quantum-memory diagnostics database

# Output
{
  "path": "~/.openclaw/quantum.db",
  "size_bytes": 45200000,
  "page_count": 11035,
  "page_size": 4096,
  "free_pages": 1203,
  "wal_size_bytes": 2100000,
  "schema_version": 5,
  "tables": {
    "messages": { "rows": 45678, "size_mb": 32.1 },
    "summaries": { "rows": 103, "size_mb": 2.3 },
    "entities": { "rows": 1234, "size_mb": 0.8 },
    "relations": { "rows": 3456, "size_mb": 1.2 }
  },
  "indexes": [
    { "name": "idx_messages_session", "unique": false, "rows": 45678 },
    ...
  ]
}
```

#### Performance Diagnostics

```bash
# Get performance profile
quantum-memory diagnostics performance

# Output
{
  "operations": {
    "store": {
      "count": 5000,
      "p50_ms": 45,
      "p95_ms": 120,
      "p99_ms": 250,
      "max_ms": 890
    },
    "get": {
      "count": 3000,
      "p50_ms": 30,
      "p95_ms": 80,
      "p99_ms": 150,
      "max_ms": 400
    },
    "search": {
      "count": 1500,
      "p50_ms": 15,
      "p95_ms": 45,
      "p99_ms": 120,
      "max_ms": 300
    }
  }
}
```

### 7.2 Debug Mode

Enable detailed debugging:

```json
{
  "quantumMemory": {
    "debug": {
      "enabled": true,
      "log_sql": true,
      "log_slow_queries_ms": 100,
      "trace_context": true
    }
  }
}
```

### 7.3 Memory Profiling

For memory issues:

```bash
# Enable heap snapshots
quantum-memory debug heap-snapshot --output heap.heapsnapshot

# Run with memory tracking
node --inspect quantum-memory.js
# Then connect Chrome DevTools
```

---

## 8. Dashboard

### 8.1 Recommended Grafana Dashboard

A recommended dashboard includes:

- **Overview Row**
  - Active Sessions (gauge)
  - Messages Today (counter)
  - Database Size (graph)

- **Performance Row**
  - Store Latency P50/P95/P99 (graph)
  - Get Latency P50/P95/P99 (graph)
  - Search Latency (graph)

- **Health Row**
  - Error Rate (graph)
  - Compaction Status (state timeline)
  - Disk Space (gauge)

- **Storage Row**
  - Messages by Status (pie chart)
  - DAG Depth Distribution (histogram)
  - Entities Over Time (graph)

---

**End of Observability Documentation**

*Document prepared for Quantum Memory implementation*
