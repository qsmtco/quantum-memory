# Quantum Memory - Database Schema Specification

**Document ID:** QM-DB-001  
**Version:** 1.1  
**Date:** 2026-03-20  
**Project:** Quantum Memory - Hybrid Memory System

> **Source of Truth:** `src/db/migrations/001-initial-schema.ts`
> This document reflects the implemented schema. The migration file is authoritative.

---

## Table of Contents

1. [Database Overview](#1-database-overview)
2. [Table Specifications](#2-table-specifications)
3. [Indexes](#3-indexes)
4. [Relationships](#4-relationships)

---

## 1. Database Overview

| Property | Value |
|----------|-------|
| **Filename** | `quantum.db` |
| **Location** | `~/.openclaw/quantum.db` |
| **Format** | SQLite 3 |
| **Journal Mode** | WAL (Write-Ahead Logging) |
| **Foreign Keys** | ENFORCED |

---

## 2. Table Specifications

### 2.1 `projects`

Top-level organization unit.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| name | TEXT | NOT NULL | Display name |
| created_at | TEXT | NOT NULL | Creation timestamp |
| updated_at | TEXT | - | Last update |
| metadata | TEXT | - | JSON for extensibility |

---

### 2.2 `sessions`

Conversation container.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | TEXT | PRIMARY KEY, UNIQUE | UUID, e.g., "sess_abc123" |
| project_id | TEXT | REFERENCES projects(id) ON DELETE SET NULL | Parent project |
| started_at | TEXT | NOT NULL | Session start |
| ended_at | TEXT | - | Session end (null if active) |
| status | TEXT | NOT NULL, CHECK IN | active/completed/archived |
| metadata | TEXT | - | JSON for extensibility |

---

### 2.3 `messages`

Raw conversation messages.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-increment ID |
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| role | TEXT | NOT NULL, CHECK IN | system/user/assistant/tool |
| content | TEXT | NOT NULL | Message text |
| token_count | INTEGER | - | Token count |
| is_compacted | INTEGER | NOT NULL DEFAULT 0 | 0=false, 1=true |
| created_at | TEXT | NOT NULL | Timestamp |

**Constraint:** `UNIQUE(session_id, id)`

---

### 2.4 `summaries`

DAG nodes for compacted summaries.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| parent_summary_id | TEXT | FK → summaries(id) ON DELETE SET NULL | DAG parent (null = root) |
| level | INTEGER | NOT NULL DEFAULT 0 | 0=leaf, 1=condensed, N=higher |
| content | TEXT | NOT NULL | Summary text |
| token_count | INTEGER | - | Token count |
| source_message_ids | TEXT | - | JSON array of source message IDs |
| created_at | TEXT | NOT NULL | Timestamp |

---

### 2.5 `entities`

Extracted named entities.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-increment |
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| name | TEXT | NOT NULL | Entity name |
| type | TEXT | NOT NULL | Entity type (person/project/tool/etc.) |
| mention_count | INTEGER | NOT NULL DEFAULT 1 | Mention count |
| first_seen | TEXT | NOT NULL | First mention timestamp |
| last_seen | TEXT | NOT NULL | Last mention timestamp |
| metadata | TEXT | - | JSON for extensibility |

**Constraint:** `UNIQUE(session_id, name, type)`

---

### 2.6 `relations`

Knowledge graph relationships.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-increment |
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| from_entity | TEXT | NOT NULL | Source entity name |
| to_entity | TEXT | NOT NULL | Target entity name |
| relation_type | TEXT | NOT NULL | knows/depends_on/uses/etc. |
| confidence | REAL | NOT NULL DEFAULT 1.0 | 0.0-1.0 |
| source_message_id | INTEGER | FK → messages(id) ON DELETE SET NULL | Source message |
| created_at | TEXT | NOT NULL | Timestamp |

**Constraint:** `UNIQUE(session_id, from_entity, to_entity, relation_type)`

> Note: `from_entity` and `to_entity` are TEXT (entity names) rather than foreign keys. The schema tracks names directly for simplicity rather than entity IDs.

---

### 2.7 `memory_inject`

Auto-recall cache.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-increment |
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| content | TEXT | NOT NULL | Injected content |
| source_ids | TEXT | - | JSON array of source IDs |
| query | TEXT | - | Query that triggered recall |
| injected_at | TEXT | NOT NULL | Injection timestamp |

---

### 2.8 `drop_log`

Smart drop tracking.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-increment |
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| message_ids | TEXT | NOT NULL | JSON array of dropped message IDs |
| reason | TEXT | NOT NULL | low_importance/redundancy/age |
| dropped_at | TEXT | NOT NULL | Drop timestamp |

---

### 2.9 `large_files`

Large file handling (for content > 25K tokens).

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | FK → sessions(id) ON DELETE CASCADE | Parent session |
| file_id | TEXT | NOT NULL | Reference ID |
| file_name | TEXT | - | Original filename |
| mime_type | TEXT | - | MIME type |
| byte_size | INTEGER | - | Original byte size |
| token_count | INTEGER | - | Token count |
| summary | TEXT | - | Auto-generated summary |
| created_at | TEXT | NOT NULL | Timestamp |

---

### 2.10 `summary_cache`

LLM summary caching.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| content_hash | TEXT | PRIMARY KEY | SHA/hash of content |
| summary | TEXT | NOT NULL | Cached summary text |
| token_count | INTEGER | - | Token count |
| created_at | TEXT | NOT NULL | Cache timestamp |

---

### 2.11 `config`

Configuration storage.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| key | TEXT | PRIMARY KEY | Config key |
| value | TEXT | NOT NULL | Config value |
| updated_at | TEXT | NOT NULL | Last update |

---

### 2.12 `schema_versions`

Migration tracking.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| version | INTEGER | PRIMARY KEY | Migration version |
| applied_at | TEXT | NOT NULL | When migration was applied |

---

## 3. Indexes

| Table | Index | Fields | Purpose |
|-------|-------|--------|---------|
| messages | idx_messages_session | session_id, created_at | Session retrieval |
| summaries | idx_summaries_session | session_id, level | DAG traversal |
| entities | idx_entities_session | session_id, type | Entity lookups |
| relations | idx_relations_session | session_id, relation_type | Relation lookups |
| memory_inject | idx_inject_session | session_id | Recall lookups |
| memory_inject | idx_inject_at | injected_at | Recall ordering |
| drop_log | idx_drop_session | session_id | Drop audit |
| drop_log | idx_drop_at | dropped_at | Drop ordering |
| large_files | idx_large_files_session | session_id | File lookups |
| large_files | idx_large_files_file_id | file_id | File reference |
| summary_cache | idx_summary_cache_hash | content_hash | Cache lookup |

---

## 4. Relationships

```
projects
  └── sessions (1:N, ON DELETE SET NULL)

sessions
  ├── messages (1:N, ON DELETE CASCADE)
  ├── summaries (1:N, ON DELETE CASCADE)
  ├── entities (1:N, ON DELETE CASCADE)
  ├── relations (1:N, ON DELETE CASCADE)
  ├── memory_inject (1:N, ON DELETE CASCADE)
  ├── drop_log (1:N, ON DELETE CASCADE)
  └── large_files (1:N, ON DELETE CASCADE)

summaries
  └── summaries (1:N self-referential via parent_summary_id)

messages
  └── relations (1:N via source_message_id, ON DELETE SET NULL)
```

---

**End of Database Schema Specification**

*Updated to reflect actual implementation*
