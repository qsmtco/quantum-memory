# Quantum Memory - Hybrid Memory System Design

**Version:** 1.0  
**Date:** 2026-03-14  
**Status:** Design Document  
**Codename:** Quantum Memory

---

## Executive Summary

This document describes **Quantum Memory** — a hybrid memory system that combines the best features from all researched approaches into a single, unified system.

**Goal:** Create the ultimate agent memory system that beats all existing solutions.

**Storage:** SQLite (extended from lossless-claw's schema)

---

## Design Principles

1. **SQLite as foundation** — Leverage existing lossless-claw infrastructure
2. **Everything in one DB** — No file system, no external services
3. **Auto-everything** — Agent shouldn't need to call tools to remember
4. **Hierarchical** — Projects → Sessions → Conversations → Events
5. **Smart** — Know WHO, WHAT, and HOW things connect
6. **Self-improving** — Learn what matters over time

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Quantum Memory                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      OpenClaw Interface                           │   │
│  │              (ContextEngine Plugin)                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    QuantumEngine Core                            │   │
│  │                                                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │   │
│  │  │   DAG        │  │  Entity      │  │  Knowledge   │        │   │
│  │  │  Compaction  │  │  Extractor   │  │    Graph     │        │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │   │
│  │                                                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │   │
│  │  │ Auto-Recall  │  │    Project   │  │    Smart     │        │   │
│  │  │  Injector    │  │   Manager    │  │   Dropper    │        │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      SQLite Database                              │   │
│  │                                                                   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │   │
│  │  │  Messages   │ │  Summaries  │ │  Entities   │ │Relations  │ │   │
│  │  │    (DAG)    │ │    (DAG)    │ │             │ │   (KG)   │ │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │   │
│  │                                                                   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │   │
│  │  │  Projects   │ │   Sessions  │ │   Config    │               │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘               │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Tables

```sql
-- Projects: Top-level organization
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME
);

-- Sessions: Per-conversation memory
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    status TEXT DEFAULT 'active', -- active, completed, archived
    metadata JSON
);

-- Messages: Raw conversation
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    role TEXT NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    importance_score REAL DEFAULT 0.5, -- 0-1
    is_compacted BOOLEAN DEFAULT FALSE
);

-- Summaries: Compacted representations (DAG nodes)
CREATE TABLE summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    parent_id TEXT REFERENCES summaries(id), -- DAG edge
    level INTEGER NOT NULL, -- 0 = leaf, 1 = condensed, 2+ = higher
    content TEXT NOT NULL,
    source_message_ids JSON, -- array of message IDs
    source_summary_ids JSON, -- array of summary IDs
    tokens INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    model_used TEXT
);

-- Entities: Extracted entities (from LangChain)
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- person, project, concept, tool, etc.
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME,
    mention_count INTEGER DEFAULT 1,
    metadata JSON
);

-- Entity Mentions: Link entities to messages
CREATE TABLE entity_mentions (
    id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES entities(id),
    message_id TEXT REFERENCES messages(id),
    context TEXT, -- surrounding text
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge Graph: Relationships (from LangChain)
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    from_entity_id TEXT REFERENCES entities(id),
    to_entity_id TEXT REFERENCES entities(id),
    relationship TEXT NOT NULL, -- knows, depends_on, created_by, etc.
    confidence REAL DEFAULT 1.0,
    source_message_id TEXT REFERENCES messages(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Memory Inject: Auto-recall queue (from Hindsight)
CREATE TABLE memory_inject (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    content TEXT NOT NULL,
    source_ids JSON, -- what triggered this
    injected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    was_useful BOOLEAN -- feedback loop
);

-- Smart Drop Log: Track what gets dropped (from OpenHands)
CREATE TABLE drop_log (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    message_ids JSON,
    reason TEXT, -- low_importance, redundancy, age
    dropped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Config: User preferences
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## Core Components

### 1. DAG Compaction (from lossless-claw)

**Purpose:** Preserve everything with minimal context blow

**How it works:**

```
Messages (unlimited)
     │
     ▼ (when > threshold)
┌─────────────────┐
│  Fresh Tail    │ (last N messages protected)
└────────┬────────┘
         │
         ▼ (compact older)
┌─────────────────┐
│  Leaf Summary  │ (LLM: summarize N messages → ~1K tokens)
└────────┬────────┘
         │
         ▼ (when > N leaves)
┌─────────────────┐
│ Condensed Node │ (LLM: summarize N leaves → ~2K tokens)
└────────┬────────┘
         │
         ▼ (unlimited depth)
┌─────────────────┐
│ Higher Node...  │
└─────────────────┘
```

**Config:**
- `fresh_tail_count` = 32 messages
- `leaf_chunk_tokens` = 20K source → 1.2K summary
- `condensed_target_tokens` = 2K
- `context_threshold` = 0.75

---

### 2. Entity Extractor (from LangChain)

**Purpose:** Know WHO and WHAT you're talking about

**How it works:**

```
Every message
     │
        ▼
┌─────────────────────────────────┐
│      NER + Pattern Matching     │
│  (names, projects, tools, etc.) │
└────────────────┬────────────────┘
                 │
        ┌────────┴────────┐
             ▼                            ▼
┌──────────────┐   ┌──────────────┐
│  New Entity? │   │ Update Stats │
│  → INSERT    │   │ → increment │
└──────────────┘   │ mention_count │
                   └───────────────┘
```

**Entity Types:**
- `person` — names, pronouns
- `project` — project names
- `tool` — commands, functions
- `concept` — ideas, patterns
- `preference` — user preferences
- `decision` — important choices
- `fact` — asserted truths

---

### 3. Knowledge Graph (from LangChain)

**Purpose:** Know HOW things connect

**How it works:**

```
Message + Extracted Entities
          │
                ▼
┌─────────────────────────────────┐
│    Relationship Detection       │
│  (X depends_on Y, A knows B)    │
└────────────────┬────────────────┘
                 │
                            ▼
        ┌────────────────┐
        │  INSERT INTO  │
        │    relations  │
        └────────────────┘
```

**Relationship Types:**
- `knows` — person ↔ person
- `created_by` — entity ↔ person
- `depends_on` — project ↔ project
- `uses` — tool ↔ entity
- `decided` — person ↔ decision
- `prefers` — person ↔ preference

---

### 4. Auto-Recall Injector (from Hindsight)

**Purpose:** Inject relevant memories before each response

**How it works:**

```
Before agent responds
     │
        ▼
┌─────────────────────────────────┐
│    Build Recall Query           │
│  (recent messages + entities)   │
└────────────────┬────────────────┘
                 │
                            ▼
┌─────────────────────────────────┐
│    Vector Similarity Search      │
│  (messages + summaries)         │
└────────────────┬────────────────┘
                 │
                            ▼
┌─────────────────────────────────┐
│    Inject into Context           │
│  (<quantum_memories> tag)       │
└─────────────────────────────────┘
```

**Features:**
- Configurable recall budget (low/mid/high)
- Max tokens per recall
- Context turns included in query
- Feedback loop: track which recalls were useful

---

### 5. Project Manager (from GPTDisk)

**Purpose:** Organize memory by context

**How it works:**

```
New conversation
     │
        ▼
┌─────────────────────────────────┐
│    Detect/select project        │
│  (channel, user, or manual)    │
└────────────────┬────────────────┘
                 │
                            ▼
        ┌────────────────┐
        │  All memory    │
        │  scoped to     │
        │  project       │
        └────────────────┘
```

**Project Detection:**
- `channel` — Slack, Telegram, etc.
- `user` — specific user
- `topic` — project name from conversation

---

### 6. Smart Dropper (from OpenHands)

**Purpose:** Automatically drop low-value content

**How it works:**

```
On each compaction pass
     │
         ▼
┌─────────────────────────────────┐
│   Score all messages            │
│  - Importance score             │
│  - Redundancy check             │
│  - Age factor                   │
└────────────────┬────────────────┘
                 │
        ┌────────┴────────┐
             ▼                             ▼
┌──────────────┐   ┌──────────────┐
│  Keep (high) │   │  DROP (low)  │
│              │   │  → log reason │
└──────────────┘   └──────────────┘
```

**Drop Criteria:**
- `importance_score < 0.1` — very low value
- `redundancy > 0.9` — same content repeated
- `age_days > 180` AND `not_referenced` — old + unused

---

## API Methods

```javascript
// Required: ContextEngine interface
class QuantumEngine {
  // Core
  async store(context)      // Save context
  async get(contextId)      // Retrieve context
  async clear(contextId)    // Archive/clear

  // Quantum features
  async getEntities(sessionId)           // List entities
  async getRelations(sessionId)          // List relationships
  async search(query, options)          // Full-text + semantic
  async injectMemories(sessionId)       // Auto-recall

  // Management
  async createProject(name)
  async listProjects()
  async setProject(projectId)
  async getProjectMemories(projectId)

  // Tuning
  async getDroppedLog(sessionId)
  async markUseful(memoryId)
}
```

---

## Configuration

```json
{
  "quantumMemory": {
    "dag": {
      "freshTailCount": 32,
      "contextThreshold": 0.75,
      "leafChunkTokens": 20000,
      "leafTargetTokens": 1200,
      "condensedTargetTokens": 2000,
      "incrementalMaxDepth": -1
    },
    "entities": {
      "enabled": true,
      "types": ["person", "project", "tool", "concept", "preference", "decision", "fact"],
      "extractOnEveryMessage": true
    },
    "knowledgeGraph": {
      "enabled": true,
      "relationshipTypes": ["knows", "depends_on", "created_by", "uses", "decided", "prefers"]
    },
    "autoRecall": {
      "enabled": true,
      "budget": "mid", // low, mid, high
      "maxTokens": 1024,
      "contextTurns": 1,
      "feedbackLoop": true
    },
    "projects": {
      "granularity": ["channel", "user"],
      "autoCreate": true
    },
    "smartDrop": {
      "enabled": true,
      "minImportance": 0.1,
      "maxRedundancy": 0.9,
      "maxAgeDays": 180
    }
  }
}
```

---

## Comparison to Existing Solutions

| Feature               | lossless-claw | MemOS | Hindsight | quantum-memory |
|-------              --|---------------|-------|-----------|----------------|
| **DAG**               |      ✅       |  ❌   |    ✅     |      ✅       |
| **LLM Summarization** |      ✅       | Cloud |    ✅     |      ✅        |
| **Entities**          |      ❌       | ❌    |    ❌     |      ✅       |
| **Knowledge Graph**   |      ❌       | ❌    |    ❌            ✅       |
| **Auto-Recall**       |      ❌       | ✅    |    ✅     |      ✅       |
| **Projects**          |      ❌       | ❌    |    ❌     |      ✅       |
| **Smart Drop**        |      ❌       | ❌    |    ❌     |      ✅        |
| **Search**            |     FTS5       | API   |  FTS5     | Full-text + KG |
| **SQLite**            |      ✅        | Cloud |    ✅    |       ✅       |

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Extend lossless-claw schema with entities, relations tables
- [ ] Implement entity extractor
- [ ] Basic search over entities

### Phase 2: Knowledge Graph
- [ ] Relationship detection
- [ ] Graph queries
- [ ] Entity-based recall

### Phase 3: Auto-Recall
- [ ] Memory injection before each turn
- [ ] Configurable budgets
- [ ] Feedback loop

### Phase 4: Projects
- [ ] Project CRUD
- [ ] Scoped queries
- [ ] Auto-detection

### Phase 5: Smart Drop
- [ ] Importance scoring
- [ ] Redundancy detection
- [ ] Drop logging

---

## Summary

**Quantum Memory** combines:

| Source | Feature |
|--------|---------|
| lossless-claw    | DAG, LLM summarization |
| LangChain         | Entity extraction, knowledge graphs |
| Hindsight       | Auto-recall injection |
| GPTDisk         | Project organization |
| OpenHands       | Smart dropping |

**Result:** The ultimate memory system that:
- Never forgets (DAG)
- Knows who/what (Entities)
- Understands relationships (KG)
- Remembers automatically (Auto-Recall)
- Stays organized (Projects)
- Stays lean (Smart Drop)

---

*Design complete. Ready for implementation review.*
