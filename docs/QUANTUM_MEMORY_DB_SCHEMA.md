# Quantum Memory - Database Schema Specification

**Document ID:** QM-DB-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Database Overview](#1-database-overview)
2. [Schema Diagrams](#2-schema-diagrams)
3. [Table Specifications](#3-table-specifications)
4. [Indexes](#4-indexes)
5. [Relationships](#5-relationships)
6. [Migrations](#6-migrations)

---

## 1. Database Overview

### 1.1 Database File

| Property | Value |
|----------|-------|
| **Filename** | `quantum.db` |
| **Location** | `~/.openclaw/quantum.db` |
| **Format** | SQLite 3 |
| **Journal Mode** | WAL (Write-Ahead Logging) |
| **Synchronous** | NORMAL |

### 1.2 Technology

- **Driver:** better-sqlite3 (synchronous)
- **ORM:** None (raw SQL)
- **Migrations:** Version-controlled SQL files

---

## 2. Schema Diagrams

### 2.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐
│  projects   │       │  sessions   │
├─────────────┤       ├─────────────┤
│ id (PK)     │◄──────│ project_id  │
│ name        │       │ id (PK)     │
│ created_at  │       │ started_at  │
│ last_accessed│      │ ended_at    │
└─────────────┘       │ status      │
                     └──────┬──────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │ messages   │ │ summaries  │ │  entities  │
       ├────────────┤ ├────────────┤ ├────────────┤
       │ id (PK)    │ │ id (PK)    │ │ id (PK)    │
       │ session_id │ │ session_id │ │ session_id │
       │ role       │ │ parent_id  │ │ name       │
       │ content    │ │ level      │ │ type       │
       │ tokens     │ │ content    │ │ mention_cnt│
       │ importance │ │ source_ids │ └─────┬──────┘
       └─────┬──────┘ └──────┬──────┘       │
             │               │               │
             │               │               │
             ▼               ▼               ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │  relations │ │memory_inject│ │ drop_log   │
       ├────────────┤ ├────────────┤ ├────────────┤
       │ from_ent  │ │ session_id │ │ session_id │
       │ to_ent    │ │ content    │ │ message_ids│
       │ relation  │ │ was_useful │ │ reason     │
       └───────────┘ └────────────┘ └────────────┘
```

### 2.2 Hierarchy Diagram

```
projects
  │
  └── sessions
        │
        ├── messages (raw conversation)
        │
        ├── summaries (DAG)
        │     │
        │     ├── level 0 (leaf)
        │     │
        │     ├── level 1 (condensed)
        │     │
        │     └── level N (higher)
        │
        ├── entities
        │     │
        │     └── relations (KG)
        │
        ├── memory_inject
        │
        └── drop_log
```

---

## 3. Table Specifications

### 3.1 projects

Top-level organization unit.

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_accessed TEXT
);
```

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID, e.g., "proj_abc123" |
| name | TEXT | NOT NULL | Display name |
| created_at | TEXT | DEFAULT | Creation timestamp |
| last_accessed | TEXT | - | Last access timestamp |

---

### 3.2 sessions

Conversation container.

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT DEFAULT 'active',
    metadata TEXT
);
```

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID, e.g., "sess_abc123" |
| project_id | TEXT | REFERENCES projects(id) | Parent project |
| started_at | TEXT | DEFAULT | Session start |
| ended_at | TEXT | - | Session end (null if active) |
| status | TEXT | DEFAULT 'active' | active/completed/archived |
| metadata | TEXT | - | JSON for extensibility |

**Status Values:**
- `active` - Currently running
- `completed` - Normal end
- `archived` - Moved to long-term storage

---

### 3.3 messages

Raw conversation messages.

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    importance_score REAL DEFAULT 0.5,
    is_compacted INTEGER DEFAULT 0
);
```

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | REFERENCES sessions(id) | Parent session |
| role | TEXT | NOT NULL | user/assistant/system |
| content | TEXT | NOT NULL | Message text |
| tokens | INTEGER | - | Token count |
| created_at | TEXT | DEFAULT | Timestamp |
| importance_score | REAL | DEFAULT 0.5 | 0.0-1.0 |
| is_compacted | INTEGER | DEFAULT 0 | 0=false, 1=true |

---

### 3.4 summaries

DAG nodes for compacted summaries.

```sql
CREATE TABLE summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    parent_id TEXT REFERENCES summaries(id),
    level INTEGER NOT NULL,
    content TEXT NOT NULL,
    source_message_ids TEXT,
    source_summary_ids TEXT,
    tokens INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    model_used TEXT
);
```

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | REFERENCES sessions(id) | Parent session |
| parent_id | TEXT | REFERENCES summaries(id) | DAG parent |
| level | INTEGER | NOT NULL | 0=leaf, 1=condensed, N=higher |
| content | TEXT | NOT NULL | Summary text |
| source_message_ids | TEXT | - | JSON array of message IDs |
| source_summary_ids | TEXT | - | JSON array of summary IDs |
| tokens | INTEGER | - | Token count |
| created_at | TEXT | DEFAULT | Timestamp |
| model_used | TEXT | - | LLM model used |

---

### 3.5 entities

Extracted named entities.

```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT,
    mention_count INTEGER DEFAULT 1,
    metadata TEXT
);
```

**Entity Types:**

| Type | Description |
|------|-------------|
| person | People's names |
| project | Project names |
| tool | Commands, functions |
| concept | Abstract ideas |
| preference | User preferences |
| decision | Important choices |
| fact | Asserted truths |

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | REFERENCES sessions(id) | Parent session |
| name | TEXT | NOT NULL | Entity name |
| type | TEXT | NOT NULL | Entity type |
| first_seen | TEXT | DEFAULT | First mention |
| last_seen | TEXT | - | Last mention |
| mention_count | INTEGER | DEFAULT 1 | Mention count |
| metadata | TEXT | - | JSON for extensibility |

---

### 3.6 relations

Knowledge graph relationships.

```sql
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    from_entity_id TEXT REFERENCES entities(id),
    to_entity_id TEXT REFERENCES entities(id),
    relationship TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    source_message_id TEXT REFERENCES messages(id),
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Relationship Types:**

| Type | Description |
|------|-------------|
| knows | Person knows person |
| depends_on | Project depends on project |
| created_by | Entity created by person |
| uses | Tool uses entity |
| decided | Person made decision |
| prefers | Person prefers preference |

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | REFERENCES sessions(id) | Parent session |
| from_entity_id | TEXT | REFERENCES entities(id) | Source entity |
| to_entity_id | TEXT | REFERENCES entities(id) | Target entity |
| relationship | TEXT | NOT NULL | Relationship type |
| confidence | REAL | DEFAULT 1.0 | 0.0-1.0 |
| source_message_id | TEXT | REFERENCES messages(id) | Source |
| created_at | TEXT | DEFAULT | Timestamp |

---

### 3.7 memory_inject

Auto-recall cache.

```sql
CREATE TABLE memory_inject (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    content TEXT NOT NULL,
    source_ids TEXT,
    injected_at TEXT DEFAULT (datetime('now')),
    was_useful INTEGER
);
```

**Fields:**

| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | REFERENCES sessions(id) | Parent session |
| content | TEXT | NOT NULL | Injected content |
| source_ids | TEXT | - | JSON array of source IDs |
| injected_at | TEXT | DEFAULT | Injection timestamp |
| was_useful | INTEGER | - | NULL=unknown, 0=no, 1=yes |

---

### 3.8 drop_log

Smart drop tracking.

```sql
CREATE TABLE drop_log (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    message_ids TEXT,
    reason TEXT,
    dropped_at TEXT DEFAULT (datetime('now'))
);
```

**Drop Reasons:**

| Reason | Description |
|--------|-------------|
| low_importance | Score below threshold |
| redundancy | Duplicate content |
| age | Old + not referenced |

---

### 3.9 config

Configuration storage.

```sql
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## 4. Indexes

### 4.1 Primary Indexes

| Table | Index Name | Fields | Purpose |
|-------|-----------|--------|---------|
| messages | idx_messages_session | session_id | Session lookups |
| messages | idx_messages_created | created_at | Date range queries |
| summaries | idx_summaries_session | session_id | Session lookups |
| summaries | idx_summaries_level | level | DAG traversal |
| entities | idx_entities_session | session_id | Session lookups |
| entities | idx_entities_name | name | Entity search |
| relations | idx_relations_from | from_entity_id | Graph traversal |
| relations | idx_relations_to | to_entity_id | Graph traversal |
| memory_inject | idx_inject_session | session_id | Recall lookups |
| drop_log | idx_drop_session | session_id | Audit queries |

### 4.2 Full-Text Search

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid'
);
```

### 4.3 Index Creation SQL

```sql
-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Summaries  
CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_summaries_level ON summaries(level);
CREATE INDEX IF NOT EXISTS idx_summaries_parent ON summaries(parent_id);

-- Entities
CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

-- Relations
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relationship);

-- Memory Inject
CREATE INDEX IF NOT EXISTS idx_inject_session ON memory_inject(session_id);
CREATE INDEX IF NOT EXISTS idx_inject_at ON memory_inject(injected_at);

-- Drop Log
CREATE INDEX IF NOT EXISTS idx_drop_session ON drop_log(session_id);
CREATE INDEX IF NOT EXISTS idx_drop_at ON drop_log(dropped_at);
```

---

## 5. Relationships

### 5.1 Foreign Key Constraints

```
projects
  └── sessions (1:N)

sessions
  ├── messages (1:N)
  ├── summaries (1:N)
  ├── entities (1:N)
  ├── relations (1:N)
  ├── memory_inject (1:N)
  └── drop_log (1:N)

summaries
  └── summaries (1:N, self-referential for DAG)

entities
  └── relations (2:N, self-referential)

messages
  └── relations (1:N, source_message_id)
```

### 5.2 Cascade Rules

| Parent | Child | On Delete |
|--------|-------|-----------|
| projects | sessions | CASCADE |
| sessions | messages | CASCADE |
| sessions | summaries | CASCADE |
| sessions | entities | CASCADE |
| sessions | relations | CASCADE |
| sessions | memory_inject | CASCADE |
| sessions | drop_log | CASCADE |
| summaries | summaries | CASCADE |
| entities | relations | CASCADE |

---

## 6. Migrations

### 6.1 Migration Strategy

- Migrations stored in `src/db/migrations/`
- Named: `001_initial_schema.sql`, `002_add_entities.sql`, etc.
- Applied in order on startup
- Version tracked in `schema_versions` table

### 6.2 Version History

| Version | Description |
|---------|-------------|
| 001 | Initial schema |
| 002 | Entities + Relations |
| 003 | Memory Inject |
| 004 | Drop Log |
| 005 | Config table |

---

## 7. Physical Considerations

### 7.1 Page Size

- Default: 4096 bytes
- Suitable for workload

### 7.2 Cache Size

- Recommended: 64 MB
- `PRAGMA cache_size = -64000`

### 7.3 WAL Mode

- Enabled for concurrent reads
- `PRAGMA journal_mode = WAL`

---

**End of Database Schema Specification**

*Document prepared for Quantum Memory implementation*
