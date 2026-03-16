# Quantum Memory - Technical Specification

**Document ID:** QM-TECH-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Layer](#2-database-layer)
3. [Core Components](#3-core-components)
4. [Implementation Details](#4-implementation-details)
5. [Integration Points](#5-integration-points)
6. [Data Flow](#6-data-flow)
7. [Error Handling](#7-error-handling)

---

## 1. Architecture Overview

### 1.1 Design Philosophy

The system follows a **modular, layered architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Interface                        │
│              (ContextEngine Plugin)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   QuantumEngine (Facade)                     │
│  - Entry point                                            │
│  - Request routing                                        │
│  - Session management                                     │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   DAG Compactor │ │   Entity       │ │  Auto-Recall   │
│                 │ │   Extractor    │ │   Injector     │
└─────────────────┘ └─────────────────┘ └─────────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SQLite Layer                             │
│  - better-sqlite3 (sync, fast)                           │
│  - Migrations                                            │
│  - Indexes                                               │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Interface | TypeScript | OpenClaw compatibility |
| Database | better-sqlite3 | Synchronous, fast, no ORM |
| LLM Calls | OpenClaw provider | Use existing config |
| Logging | OpenClaw logger | Integrated |

### 1.3 Directory Structure

```
quantum-memory/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── engine/
│   │   ├── QuantumEngine.ts  # Main facade
│   │   ├── ContextStore.ts   # Message storage
│   │   └── SessionManager.ts # Session lifecycle
│   ├── dag/
│   │   ├── Compactor.ts     # DAG compaction logic
│   │   ├── Summarizer.ts    # LLM integration
│   │   └── Node.ts          # DAG node types
│   ├── entities/
│   │   ├── Extractor.ts     # NER
│   │   ├── EntityStore.ts   # Entity CRUD
│   │   └── RelationBuilder.ts # KG creation
│   ├── recall/
│   │   ├── Injector.ts     # Auto-recall
│   │   ├── Retriever.ts     # Similarity search
│   │   └── FeedbackLoop.ts  # Usefulness tracking
│   ├── projects/
│   │   ├── ProjectManager.ts # Project CRUD
│   │   └── Scoper.ts        # Query scoping
│   ├── search/
│   │   ├── SearchEngine.ts  # FTS5 search
│   │   └── Ranker.ts        # Result ranking
│   ├── db/
│   │   ├── Database.ts      # Connection management
│   │   ├── migrations/       # Schema migrations
│   │   └── indexes.ts       # Index definitions
│   └── utils/
│       ├── tokenizer.ts     # Token counting
│       └── config.ts       # Config management
├── test/
│   ├── unit/
│   └── integration/
├── package.json
└── tsconfig.json
```

---

## 2. Database Layer

### 2.1 Technology Choice: better-sqlite3

**Rationale:**
- Synchronous API (no async overhead)
- Faster than async drivers for single-threaded Node
- No ORM needed (simple schema)
- Built-in FTS5 support

### 2.2 Connection Management

```typescript
// src/db/Database.ts
import Database from 'better-sqlite3';

class DatabaseManager {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }
  
  get connection(): Database.Database {
    return this.db;
  }
}
```

### 2.3 Schema Definition

```typescript
// src/db/schema.ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT DEFAULT 'active',
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  importance_score REAL DEFAULT 0.5,
  is_compacted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS summaries (
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

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT,
  mention_count INTEGER DEFAULT 1,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  from_entity_id TEXT REFERENCES entities(id),
  to_entity_id TEXT REFERENCES entities(id),
  relationship TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  source_message_id TEXT REFERENCES messages(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_inject (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  content TEXT NOT NULL,
  source_ids TEXT,
  injected_at TEXT DEFAULT (datetime('now')),
  was_useful INTEGER
);

CREATE TABLE IF NOT EXISTS drop_log (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  message_ids TEXT,
  reason TEXT,
  dropped_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);
`;
```

### 2.4 Index Strategy

```typescript
// src/db/indexes.ts
export const INDEXES = [
  // Messages
  'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)',
  
  // Summaries
  'CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_summaries_level ON summaries(level)',
  
  // Entities
  'CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)',
  
  // Relations
  'CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id)',
  'CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id)',
];
```

---

## 3. Core Components

### 3.1 QuantumEngine (Facade)

```typescript
// src/engine/QuantumEngine.ts
export class QuantumEngine implements ContextEngine {
  private db: DatabaseManager;
  private sessionManager: SessionManager;
  private compactor: DAGCompactor;
  private entityExtractor: EntityExtractor;
  private entityStore: EntityStore;
  private relationBuilder: RelationBuilder;
  private autoRecall: AutoRecallInjector;
  private projectManager: ProjectManager;
  private searchEngine: SearchEngine;
  
  constructor(config: QuantumConfig) {
    this.db = new DatabaseManager(config.dbPath);
    this.sessionManager = new SessionManager(this.db);
    this.compactor = new DAGCompactor(this.db, config.dag);
    this.entityExtractor = new EntityExtractor(config.entities);
    this.entityStore = new EntityStore(this.db);
    this.relationBuilder = new RelationBuilder(this.db);
    this.autoRecall = new AutoRecallInjector(this.db, config.autoRecall);
    this.projectManager = new ProjectManager(this.db, config.projects);
    this.searchEngine = new SearchEngine(this.db);
  }
  
  async store(context: Context): Promise<{id: string}> {
    // 1. Ensure session exists
    // 2. Store messages
    // 3. Extract entities
    // 4. Build relations
    // 5. Check compaction threshold
    // 6. Queue auto-recall
  }
  
  async get(params: {contextId: string}): Promise<Context> {
    // 1. Load session
    // 2. Reconstruct DAG
    // 3. Inject memories
    // 4. Return context
  }
  
  async clear(params: {contextId: string}): Promise<boolean> {
    // Archive session
  }
}
```

### 3.2 DAG Compactor

```typescript
// src/dag/Compactor.ts
export class DAGCompactor {
  private db: DatabaseManager;
  private config: DAGConfig;
  private summarizer: LLMSummarizer;
  
  async maybeCompact(sessionId: string): Promise<void> {
    // 1. Get message count
    // 2. If exceeds threshold, trigger compaction
    // 3. Create leaf summaries
    // 4. If leaf count exceeds threshold, create condensed
    // 5. Continue cascading
  }
  
  async createLeafSummary(sessionId: string): Promise<Summary> {
    // 1. Get unprotected messages
    // 2. Chunk into ~20K token groups
    // 3. For each chunk, call LLM
    // 4. Create summary nodes
    // 5. Store source message IDs
    // 6. Mark messages as compacted
  }
  
  async createCondensedSummary(sessionId: string, level: number): Promise<Summary> {
    // 1. Get summaries at current level
    // 2. If count > fanout threshold
    // 3. Call LLM to summarize
    // 4. Create condensed node
    // 5. Link to parent
  }
  
  async reconstructContext(sessionId: string, maxTokens: number): Promise<Context> {
    // 1. Start with fresh tail
    // 2. Add leaf summaries (if needed)
    // 3. Add condensed summaries (if needed)
    // 4. Fill remaining with higher summaries
    // 5. Return context
  }
}
```

### 3.3 Entity Extractor

```typescript
// src/entities/Extractor.ts
export class EntityExtractor {
  private patterns: Map<EntityType, RegExp[]>;
  
  extract(message: Message): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    
    for (const [type, patterns] of this.patterns) {
      for (const pattern of patterns) {
        const matches = message.content.matchAll(pattern);
        for (const match of matches) {
          entities.push({
            name: match[1],
            type,
            context: this.getContext(message.content, match.index)
          });
        }
      }
    }
    
    return entities;
  }
  
  private getPatterns(): Map<EntityType, RegExp[]> {
    return new Map([
      ['person', [/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g]],
      ['project', [/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+Project\b/gi]],
      ['tool', [/\b(\/[a-z]+)\b/g]], // Slash commands
      ['concept', [/\b(quantum memory|dag|kg|llm)\b/gi]]
    ]);
  }
}
```

### 3.4 Knowledge Graph Builder

```typescript
// src/entities/RelationBuilder.ts
export class RelationBuilder {
  private patterns: RelationPattern[];
  
  analyze(message: Message, entities: Entity[]): Relation[] {
    const relations: Relation[] = [];
    
    for (const pattern of this.patterns) {
      if (pattern.matches(message.content, entities)) {
        relations.push({
          from: pattern.from(entities),
          to: pattern.to(entities),
          type: pattern.type,
          confidence: pattern.confidence
        });
      }
    }
    
    return relations;
  }
  
  private getPatterns(): RelationPattern[] {
    return [
      {
        type: 'knows',
        matches: (text: string) => /\bknows?\b/i.test(text),
        from: (ents: Entity[]) => ents.find(e => e.type === 'person'),
        to: (ents: Entity[]) => ents.find(e => e.type === 'person'),
        confidence: 0.8
      },
      {
        type: 'depends_on',
        matches: (text: string) => /\b(depends on|requires|needs)\b/i.test(text),
        from: (ents: Entity[]) => ents.find(e => e.type === 'project'),
        to: (ents: Entity[]) => ents.find(e => e.type === 'project'),
        confidence: 0.9
      },
      // ... more patterns
    ];
  }
}
```

### 3.5 Auto-Recall Injector

```typescript
// src/recall/Injector.ts
export class AutoRecallInjector {
  private db: DatabaseManager;
  private config: AutoRecallConfig;
  private retriever: Retriever;
  
  async inject(sessionId: string, currentContext: Context): Promise<string> {
    // 1. Build recall query from recent messages + entities
    const query = this.buildQuery(currentContext);
    
    // 2. Retrieve relevant memories
    const memories = await this.retriever.findRelevant(query, {
      sessionId,
      maxTokens: this.getBudgetTokens()
    });
    
    // 3. Format as inject tag
    const inject = this.formatInject(memories);
    
    // 4. Store inject record
    this.recordInject(sessionId, memories);
    
    return inject;
  }
  
  private buildQuery(context: Context): string {
    // Extract key terms from recent messages
    // Add entity names
    // Combine into search string
  }
  
  private getBudgetTokens(): number {
    switch (this.config.budget) {
      case 'low': return 256;
      case 'mid': return 1024;
      case 'high': return 4096;
    }
  }
  
  private formatInject(memories: Memory[]): string {
    return `<quantum_memories>
${memories.map(m => `- ${m.content}`).join('\n')}
</quantum_memories>`;
  }
}
```

---

## 4. Implementation Details

### 4.1 LLM Integration

```typescript
// src/dag/Summarizer.ts
export class LLMSummarizer {
  private provider: LLMProvider;
  
  async summarize(messages: Message[], targetTokens: number): Promise<string> {
    const prompt = this.buildPrompt(messages, targetTokens);
    
    const response = await this.provider.complete({
      messages: [
        { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      maxTokens: targetTokens
    });
    
    return response.content;
  }
  
  private buildPrompt(messages: Message[], targetTokens: number): string {
    return `Summarize these messages into approximately ${targetTokens} tokens:
    
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Summary:`;
  }
}
```

### 4.2 Token Counting

```typescript
// src/utils/tokenizer.ts
export function countTokens(text: string): number {
  // Approximate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// For accurate counting, use tiktoken
import { encoding_for_model } from 'tiktoken';

export function countTokensAccurate(text: string, model: string): number {
  const enc = encoding_for_model(model);
  return enc.encode(text).length;
}
```

### 4.3 Configuration Resolution

```typescript
// src/utils/config.ts
export function resolveConfig(openclawConfig: any): QuantumConfig {
  const qm = openclawConfig.plugins?.quantumMemory || {};
  
  return {
    dbPath: process.env.QUANTUM_DB_PATH || '~/.openclaw/quantum.db',
    dag: {
      freshTailCount: qm.dag?.freshTailCount || 32,
      contextThreshold: qm.dag?.contextThreshold || 0.75,
      leafChunkTokens: qm.dag?.leafChunkTokens || 20000,
      leafTargetTokens: qm.dag?.leafTargetTokens || 1200,
      condensedTargetTokens: qm.dag?.condensedTargetTokens || 2000
    },
    entities: {
      enabled: qm.entities?.enabled !== false,
      types: qm.entities?.types || ['person', 'project', 'tool', 'concept']
    },
    knowledgeGraph: {
      enabled: qm.knowledgeGraph?.enabled !== false
    },
    autoRecall: {
      enabled: qm.autoRecall?.enabled !== false,
      budget: qm.autoRecall?.budget || 'mid',
      maxTokens: qm.autoRecall?.maxTokens || 1024
    },
    projects: {
      granularity: qm.projects?.granularity || ['channel', 'user'],
      autoCreate: qm.projects?.autoCreate !== false
    },
    smartDrop: {
      enabled: qm.smartDrop?.enabled !== false,
      minImportance: qm.smartDrop?.minImportance || 0.1
    }
  };
}
```

---

## 5. Integration Points

### 5.1 OpenClaw Context Engine

```typescript
// src/index.ts
import { ContextEngine } from '@openclaw/core';

export function getStorage(context: OpenClawContext): ContextEngine {
  const config = resolveConfig(context.config);
  return new QuantumEngine(config);
}
```

### 5.2 LLM Provider

```typescript
// Use OpenClaw's existing LLM configuration
interface LLMProvider {
  complete(params: {
    messages: Message[];
    maxTokens: number;
    model?: string;
  }): Promise<{ content: string }>;
}
```

### 5.3 Config System

```typescript
// Register with OpenClaw config
export const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    quantumMemory: {
      type: 'object',
      properties: {
        dag: { type: 'object' },
        entities: { type: 'object' },
        knowledgeGraph: { type: 'object' },
        autoRecall: { type: 'object' },
        projects: { type: 'object' },
        smartDrop: { type: 'object' }
      }
    }
  }
};
```

---

## 6. Data Flow

### 6.1 Store Flow

```
User Message
     │
     ▼
QuantumEngine.store()
     │
     ├──→ SessionManager.ensureSession()
     │
     ├──→ ContextStore.insertMessages()
     │         │
     │         └──→ SQLite messages table
     │
     ├──→ EntityExtractor.extract()
     │         │
     │         └──→ EntityStore.upsert()
     │
     ├──→ RelationBuilder.analyze()
     │         │
     │         └──→ RelationStore.insert()
     │
     ├──→ DAGCompactor.maybeCompact()
     │         │
     │         └──→ (if threshold exceeded)
     │               ├──→ Summarizer.summarize()
     │               └──→ SummaryStore.insert()
     │
     └──→ AutoRecallInjector.prepare()
               │
               └──→ (queues for next get)
```

### 6.2 Retrieve Flow

```
Agent Request
     │
     ▼
QuantumEngine.get()
     │
     ├──→ SessionManager.load()
     │
     ├──→ DAGCompactor.reconstruct()
     │         │
     │         ├──→ Fresh tail (uncompacted messages)
     │         ├──→ Leaf summaries
     │         └──→ Condensed summaries
     │
     ├──→ AutoRecallInjector.inject()
     │         │
     │         ├──→ Build query
     │         ├──→ Retrieve memories
     │         └──→ Format for context
     │
     └──→ Return assembled context
```

---

## 7. Error Handling

### 7.1 Error Types

```typescript
// src/errors.ts
export class QuantumError extends Error {
  code: string;
  details?: any;
}

export class DatabaseError extends QuantumError {
  constructor(message: string, details?: any) {
    super(message, 'DB_ERROR');
    this.name = 'DatabaseError';
    this.details = details;
  }
}

export class LLMSummarizationError extends QuantumError {
  constructor(message: string, details?: any) {
    super(message, 'LLM_ERROR');
    this.name = 'LLMSummarizationError';
    this.details = details;
  }
}

export class ConfigurationError extends QuantumError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}
```

### 7.2 Recovery Strategies

| Error | Strategy |
|-------|----------|
| DB write failure | Retry 3x, then throw |
| LLM failure | Fall back to extractive summary |
| Corrupt message | Skip, log, continue |
| Full disk | Alert, disable write |
| Schema migration | Backup, migrate, verify |

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Database operations
- Entity extraction patterns
- Token counting
- Config resolution

### 8.2 Integration Tests

- Store → get roundtrip
- DAG compaction
- Entity extraction
- Search

### 8.3 Performance Tests

- 10K message session
- Concurrent sessions
- Search latency

---

**End of Technical Specification**

*Document prepared for Quantum Memory implementation*
