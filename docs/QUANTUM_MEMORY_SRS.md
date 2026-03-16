# Quantum Memory - Software Requirements Specification

**Document ID:** QM-SRS-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Status:** Approved for Implementation  
**Project:** Quantum Memory - Hybrid Memory System for OpenClaw

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-14 | Qaster | Initial SRS |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [External Interface Requirements](#3-external-interface-requirements)
4. [Functional Requirements](#4-functional-requirements)
5. [Performance Requirements](#5-performance-requirements)
6. [Logical Database Requirements](#6-logical-database-requirements)
7. [Design Constraints](#7-design-constraints)
8. [Software System Attributes](#8-software-system-attributes)
9. [Supporting Information](#9-supporting-information)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines the complete requirements for **Quantum Memory** — a hybrid memory system that combines the best features from multiple approaches into a unified, SQLite-backed solution for the OpenClaw agent platform.

Quantum Memory provides intelligent context management through DAG-based summarization, entity extraction, knowledge graphs, auto-recall injection, project organization, and smart content dropping.

### 1.2 Scope

Quantum Memory is a plugin for OpenClaw that provides:

1. **DAG-Based Compaction** — Preserve all messages through hierarchical summarization
2. **Entity Extraction** — Automatically identify and track people, projects, tools, and concepts
3. **Knowledge Graphs** — Map relationships between extracted entities
4. **Auto-Recall Injection** — Intelligently inject relevant memories before each response
5. **Project Organization** — Organize memory by project, user, or channel
6. **Smart Content Dropping** — Automatically remove low-value content
7. **Full-Text Search** — Fast search across all stored content

### 1.3 Definitions

| Term | Definition |
|------|------------|
| **DAG** | Directed Acyclic Graph — hierarchical structure where summaries link to their sources |
| **Leaf Summary** | First-level summary, derived from raw messages |
| **Condensed Summary** | Second-level summary, derived from leaf summaries |
| **Entity** | Named concept extracted from conversation (person, project, tool, etc.) |
| **Relation** | Connection between two entities (knows, depends_on, etc.) |
| **Memory Inject** | Auto-recalled content injected before agent response |
| **Context Engine** | OpenClaw plugin interface for custom memory management |
| **Session** | Single conversation thread |

### 1.4 References

| Reference | Description |
|-----------|-------------|
| QUANTUM_MEMORY_HYBRID_DESIGN.md | System architecture and design document |

---

## 2. Overall Description

### 2.1 Product Perspective

Quantum Memory operates as an OpenClaw Context Engine plugin. It intercepts context save/load operations and provides intelligent memory management.

**System Context:**

```
OpenClaw Core
     │
     │ Context save/load
     ▼
┌────────────────────────────────┐
│    Quantum Memory Plugin        │
│                                │
│  ┌────────────┐ ┌──────────┐ │
│  │   DAG       │ │  Entity  │ │
│  │ Compaction  │ │ Extractor │ │
│  └────────────┘ └──────────┘ │
│                                │
│  ┌────────────┐ ┌──────────┐ │
│  │  Auto-     │ │ Project  │ │
│  │  Recall    │ │ Manager  │ │
│  └────────────┘ └──────────┘ │
│                                │
└────────────────────────────────┘
              │
              ▼
        SQLite Database
```

### 2.2 Product Functions

| Function | Description |
|----------|-------------|
| Store Context | Persist messages to SQLite |
| Retrieve Context | Load context with DAG reconstruction |
| DAG Compaction | Create hierarchical summaries |
| Entity Extraction | Identify named entities in messages |
| Knowledge Graph | Map entity relationships |
| Auto-Recall | Inject relevant memories before response |
| Project Management | Organize memory by project |
| Smart Dropping | Remove low-value content automatically |
| Search | Full-text and semantic search |

### 2.3 User Classes

| User Class | Description |
|------------|-------------|
| **OpenClaw Core** | Platform runtime invoking context methods |
| **Agent** | AI using memory for context |
| **Human User** | Supervisor reviewing memories |

### 2.4 Operating Environment

| Component | Requirement |
|-----------|-------------|
| Node.js | 22.x or higher |
| SQLite | 3.x (built-in) |
| OpenClaw | Latest with Context Engine support |
| OS | Linux, macOS, Windows |

---

## 3. External Interface Requirements

### 3.1 Plugin Interface

Quantum Memory implements the OpenClaw Context Engine interface:

```javascript
module.exports = {
  getStorage: (context) => new QuantumEngine(context)
};
```

### 3.2 Storage API

| Method | Signature | Description |
|--------|-----------|-------------|
| store | `async store(context): Promise<{id: string}>` | Persist context |
| get | `async get(params: {contextId: string}): Promise<Context>` | Retrieve context |
| clear | `async clear(params: {contextId: string}): Promise<boolean>` | Archive context |

### 3.3 Quantum API

| Method | Signature | Description |
|--------|-----------|-------------|
| getEntities | `async getEntities(sessionId): Promise<Entity[]>` | List extracted entities |
| getRelations | `async getRelations(sessionId): Promise<Relation[]>` | List relationships |
| search | `async search(query: string, options?: SearchOptions): Promise<SearchResult[]>` | Full-text + semantic search |
| injectMemories | `async injectMemories(sessionId): Promise<InjectResult>` | Auto-recall |
| createProject | `async createProject(name: string): Promise<Project>` | Create project |
| listProjects | `async listProjects(): Promise<Project[]>` | List all projects |
| setProject | `async setProject(projectId: string): void` | Switch active project |
| getDroppedLog | `async getDroppedLog(sessionId): Promise<DropRecord[]>` | View dropped content |

### 3.4 Configuration Schema

```json
{
  "quantumMemory": {
    "dag": {
      "freshTailCount": { "type": "integer", "default": 32 },
      "contextThreshold": { "type": "number", "default": 0.75 },
      "leafChunkTokens": { "type": "integer", "default": 20000 },
      "leafTargetTokens": { "type": "integer", "default": 1200 },
      "condensedTargetTokens": { "type": "integer", "default": 2000 }
    },
    "entities": {
      "enabled": { "type": "boolean", "default": true },
      "types": { "type": "array", "default": ["person", "project", "tool", "concept", "preference", "decision"] }
    },
    "knowledgeGraph": {
      "enabled": { "type": "boolean", "default": true }
    },
    "autoRecall": {
      "enabled": { "type": "boolean", "default": true },
      "budget": { "type": "string", "enum": ["low", "mid", "high"], "default": "mid" },
      "maxTokens": { "type": "integer", "default": 1024 }
    },
    "projects": {
      "granularity": { "type": "array", "default": ["channel", "user"] },
      "autoCreate": { "type": "boolean", "default": true }
    },
    "smartDrop": {
      "enabled": { "type": "boolean", "default": true },
      "minImportance": { "type": "number", "default": 0.1 }
    }
  }
}
```

---

## 4. Functional Requirements

### 4.1 Context Storage

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| CS-001 | System shall persist all messages to SQLite | Must |
| CS-002 | System shall assign unique IDs to each message | Must |
| CS-003 | System shall track message timestamps | Must |
| CS-004 | System shall calculate token counts for messages | Must |
| CS-005 | System shall mark messages as compacted after summarization | Must |

### 4.2 DAG Compaction

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| DG-001 | System shall protect last N messages from compaction (fresh tail) | Must |
| DG-002 | System shall generate leaf summaries when threshold exceeded | Must |
| DG-003 | System shall create condensed summaries from leaf summaries | Must |
| DG-004 | System shall support unlimited DAG depth | Should |
| DG-005 | System shall use LLM for summarization | Must |
| DG-006 | System shall preserve source message IDs in summaries | Must |
| DG-007 | System shall reconstruct context from DAG on retrieval | Must |

### 4.3 Entity Extraction

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| EN-001 | System shall extract person names from messages | Must |
| EN-002 | System shall extract project names from messages | Must |
| EN-003 | System shall extract tool names from messages | Must |
| EN-004 | System shall extract concept names from messages | Must |
| EN-005 | System shall track entity mention counts | Must |
| EN-006 | System shall update entity last_seen on each mention | Must |
| EN-007 | System shall support custom entity types | Should |

### 4.4 Knowledge Graph

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| KG-001 | System shall detect "knows" relationships | Must |
| KG-002 | System shall detect "depends_on" relationships | Must |
| KG-003 | System shall detect "uses" relationships | Must |
| KG-004 | System shall store relationships with confidence scores | Must |
| KG-005 | System shall link relationships to source messages | Must |

### 4.5 Auto-Recall

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| AR-001 | System shall inject memories before each agent response | Must |
| AR-002 | System shall use recent context to build recall query | Must |
| AR-003 | System shall respect token budget limits | Must |
| AR-004 | System shall inject memories as tagged context | Must |
| AR-005 | System shall track which injections were useful (feedback loop) | Should |

### 4.6 Project Management

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| PM-001 | System shall create new projects | Must |
| PM-002 | System shall list all projects | Must |
| PM-003 | System shall associate sessions with projects | Must |
| PM-004 | System shall scope queries to active project | Must |
| PM-005 | System shall auto-detect project from channel/user | Should |

### 4.7 Smart Dropping

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| SD-001 | System shall calculate importance scores for messages | Must |
| SD-002 | System shall identify redundant content | Must |
| SD-003 | System shall drop messages below importance threshold | Must |
| SD-004 | System shall log all dropped content | Must |
| SD-005 | System shall preserve entities from dropped content | Must |

### 4.8 Search

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| SH-001 | System shall support keyword search | Must |
| SH-002 | System shall support entity-based search | Should |
| SH-003 | System shall return ranked results | Must |
| SH-004 | System shall support date range filtering | Should |

---

## 5. Performance Requirements

### 5.1 Response Times

| Operation | Target | Maximum |
|-----------|--------|---------|
| Store context | 50 ms | 200 ms |
| Retrieve context | 100 ms | 500 ms |
| Entity extraction | 10 ms | 50 ms |
| Search | 100 ms | 500 ms |
| Auto-recall injection | 50 ms | 200 ms |

### 5.2 Throughput

| Operation | Target | Maximum |
|-----------|--------|---------|
| Messages stored/sec | 500 | 1000 |
| Concurrent sessions | 50 | 100 |

### 5.3 Storage

| Resource | Limit |
|----------|-------|
| Max messages per session | 100,000 |
| Max entities per session | 10,000 |
| Max relations per session | 50,000 |
| Database size | 1 GB (warn), 10 GB (max) |

---

## 6. Logical Database Requirements

### 6.1 Database Overview

| Table | Purpose | Size Estimate |
|-------|---------|---------------|
| projects | Top-level organization | < 1 KB |
| sessions | Conversation containers | < 1 KB |
| messages | Raw conversation | Primary storage |
| summaries | DAG nodes | 10% of messages |
| entities | Extracted entities | 1% of messages |
| relations | Knowledge graph | 5% of messages |
| memory_inject | Auto-recall cache | < 10 MB |
| drop_log | Dropped content | < 1 MB |

### 6.2 Schema Requirements

All tables must include:
- Primary key (TEXT UUID)
- Timestamps (DATETIME)
- Session foreign key where applicable
- JSON metadata field for extensibility

### 6.3 Indexes Required

| Table | Index Fields | Purpose |
|-------|-------------|---------|
| messages | session_id, created_at | Session retrieval |
| messages | content (FTS5) | Full-text search |
| summaries | session_id, level | DAG traversal |
| entities | session_id, name | Entity lookup |
| relations | from_entity_id, to_entity_id | Graph traversal |
| memory_inject | session_id, injected_at | Recall ordering |

---

## 7. Design Constraints

### 7.1 Technical Constraints

| Constraint | Description |
|------------|-------------|
| T-001 | Must implement OpenClaw Context Engine interface |
| T-002 | Must use SQLite for all storage |
| T-003 | Must not require external services |
| T-004 | Must work offline |
| T-005 | Must handle graceful shutdown |

### 7.2 Platform Constraints

| Constraint | Description |
|------------|-------------|
| P-001 | Must run as OpenClaw plugin |
| P-002 | Must use OpenClaw's LLM for summarization |
| P-003 | Must integrate with OpenClaw config system |

### 7.3 Operational Constraints

| Constraint | Description |
|------------|-------------|
| O-001 | Must not block agent response during compaction |
| O-002 | Must handle database corruption gracefully |
| O-003 | Must provide migration path for schema updates |

---

## 8. Software System Attributes

### 8.1 Reliability

| Attribute | Requirement |
|-----------|-------------|
| Data persistence | Zero data loss on normal shutdown |
| Corruption recovery | Auto-repair from message source |
| Error handling | Graceful degradation, no crashes |

### 8.2 Performance

| Attribute | Requirement |
|-----------|-------------|
| Latency | All operations within specified limits |
| Throughput | Support specified message rates |
| Memory | < 500 MB RAM usage |

### 8.3 Security

| Attribute | Requirement |
|-----------|-------------|
| Access | File permissions via OS |
| Privacy | All data local, no external transmission |

### 8.4 Maintainability

| Attribute | Requirement |
|-----------|-------------|
| Logging | Structured logs at INFO/WARN/ERROR |
| Config | All tunable via OpenClaw config |
| Testing | > 80% code coverage |

### 8.5 Extensibility

| Attribute | Requirement |
|-----------|-------------|
| Entity types | Configurable entity types |
| Relationship types | Configurable relationship types |
| Compaction | Tunable thresholds |

---

## 9. Supporting Information

### 9.1 Glossary

| Term | Definition |
|------|------------|
| DAG | Directed Acyclic Graph — hierarchical summary structure |
| Leaf Summary | First-level summary from raw messages |
| Condensed Summary | Summary of summaries at next level |
| Entity | Named concept extracted from conversation |
| Relation | Connection between two entities |
| Context Engine | OpenClaw plugin interface |
| Session | Single conversation thread |
| Project | Top-level organization unit |

### 9.2 Related Documents

| Document | Location |
|----------|----------|
| QUANTUM_MEMORY_HYBRID_DESIGN.md | docs/ |

---

**End of Software Requirements Specification**

*Document prepared by Qaster*
*For questions, consult QUANTUM_MEMORY_HYBRID_DESIGN.md*
