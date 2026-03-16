# Quantum Memory - API Specification

**Document ID:** QM-API-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Overview](#1-overview)
2. [Context Engine Interface](#2-context-engine-interface)
3. [Core API](#3-core-api)
4. [Entity API](#4-entity-api)
5. [Search API](#5-search-api)
6. [Project API](#6-project-api)
7. [Configuration API](#7-configuration-api)
8. [Data Types](#8-data-types)

---

## 1. Overview

### 1.1 API Structure

Quantum Memory provides three API layers:

| Layer | Description |
|-------|-------------|
| **Context Engine** | OpenClaw plugin interface (required) |
| **Core API** | Core memory operations |
| **Quantum API** | Extended features (entities, search, projects) |

### 1.2 Base URL

```typescript
// All methods are synchronous class methods
const qm = new QuantumEngine(config);
```

---

## 2. Context Engine Interface

### 2.1 getStorage

Returns a QuantumEngine instance.

```typescript
function getStorage(context: OpenClawContext): QuantumEngine
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| context | OpenClawContext | OpenClaw runtime context |

**Returns:** `QuantumEngine` instance

**Example:**
```typescript
const storage = getStorage({
  workspace: '/home/user/.openclaw',
  config: { quantumMemory: { ... } },
  logger: console
});
```

---

## 3. Core API

### 3.1 store

Persist context to memory.

```typescript
async store(context: Context): Promise<StoreResult>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| context | Context | Yes | Context object to persist |

**Context Object:**
```typescript
interface Context {
  sessionId?: string;
  messages: Message[];
  state?: Record<string, any>;
  metadata?: Record<string, any>;
}
```

**Returns:**
```typescript
interface StoreResult {
  id: string;           // Session ID
  messagesStored: number;
  entitiesExtracted: number;
}
```

**Example:**
```typescript
const result = await qm.store({
  sessionId: 'session-123',
  messages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' }
  ],
  state: { active: true }
});

console.log(result.id);         // 'session-123'
console.log(result.messagesStored);  // 2
console.log(result.entitiesExtracted);  // 0
```

---

### 3.2 get

Retrieve context from memory.

```typescript
async get(params: GetParams): Promise<RetrievedContext>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| params | GetParams | Yes | Retrieval parameters |

**GetParams:**
```typescript
interface GetParams {
  contextId: string;           // Session ID to retrieve
  maxTokens?: number;          // Max tokens in context (default: unlimited)
  includeMemories?: boolean;   // Include auto-recall memories (default: true)
}
```

**Returns:**
```typescript
interface RetrievedContext {
  sessionId: string;
  messages: Message[];
  state: string;
  metadata: ContextMetadata;
  injectedMemories?: string[];
}
```

**ContextMetadata:**
```typescript
interface ContextMetadata {
  messageCount: number;
  summaryCount: number;
  tokenCount: number;
  createdAt: string;
  lastUpdated: string;
}
```

**Example:**
```typescript
const context = await qm.get({
  contextId: 'session-123',
  maxTokens: 8000,
  includeMemories: true
});

console.log(context.messages);      // [{ role: 'user', content: 'Hello' }, ...]
console.log(context.injectedMemories);  // ['Previous discussion about X...']
```

---

### 3.3 clear

Archive and remove a session.

```typescript
async clear(params: ClearParams): Promise<ClearResult>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| params | ClearParams | Yes | Clear parameters |

**ClearParams:**
```typescript
interface ClearParams {
  contextId: string;           // Session ID to archive
  deletePermanently?: boolean; // Skip archive, delete forever (default: false)
}
```

**Returns:**
```typescript
interface ClearResult {
  archived: boolean;
  location?: string;           // Archive path if archived
}
```

**Example:**
```typescript
const result = await qm.clear({
  contextId: 'session-123'
});

console.log(result.archived);  // true
console.log(result.location);  // '/path/to/archive/session-123.jsonl.gz'
```

---

### 3.4 createSession

Create a new session.

```typescript
async createSession(params: CreateSessionParams): Promise<Session>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| params | CreateSessionParams | No | Session parameters |

**CreateSessionParams:**
```typescript
interface CreateSessionParams {
  projectId?: string;         // Associated project
  metadata?: Record<string, any>;
}
```

**Returns:**
```typescript
interface Session {
  id: string;
  projectId?: string;
  startedAt: string;
  status: 'active' | 'completed' | 'archived';
}
```

**Example:**
```typescript
const session = await qm.createSession({
  projectId: 'work'
});

console.log(session.id);      // 'session-abc-123'
console.log(session.status);  // 'active'
```

---

### 3.5 completeSession

Mark session as completed.

```typescript
async completeSession(sessionId: string): Promise<boolean>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| sessionId | string | Yes | Session to complete |

**Returns:** `boolean` - Success

**Example:**
```typescript
await qm.completeSession('session-123');
```

---

## 4. Entity API

### 4.1 getEntities

List all entities for a session.

```typescript
async getEntities(sessionId: string, filters?: EntityFilters): Promise<Entity[]>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| sessionId | string | Yes | Session ID |
| filters | EntityFilters | No | Filtering options |

**EntityFilters:**
```typescript
interface EntityFilters {
  type?: EntityType;          // Filter by type
  minMentions?: number;       // Minimum mention count
  limit?: number;             // Max results (default: 100)
}
```

**EntityType:**
```typescript
type EntityType = 'person' | 'project' | 'tool' | 'concept' | 'preference' | 'decision' | 'fact';
```

**Returns:** `Entity[]`

**Entity:**
```typescript
interface Entity {
  id: string;
  name: string;
  type: EntityType;
  firstSeen: string;
  lastSeen: string;
  mentionCount: number;
  metadata?: Record<string, any>;
}
```

**Example:**
```typescript
const entities = await qm.getEntities('session-123', {
  type: 'person',
  minMentions: 2
});

entities.forEach(e => {
  console.log(`${e.name} (${e.type}): ${e.mentionCount} mentions`);
});
// Output:
// John (person): 5 mentions
// Jane (person): 3 mentions
```

---

### 4.2 getRelations

List relationships between entities.

```typescript
async getRelations(sessionId: string, options?: RelationFilters): Promise<Relation[]>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| sessionId | string | Yes | Session ID |
| options | RelationFilters | No | Filtering options |

**RelationFilters:**
```typescript
interface RelationFilters {
  fromEntityId?: string;      // Filter by source entity
  toEntityId?: string;        // Filter by target entity
  type?: RelationType;        // Filter by relationship type
  limit?: number;
}
```

**RelationType:**
```typescript
type RelationType = 'knows' | 'depends_on' | 'created_by' | 'uses' | 'decided' | 'prefers';
```

**Returns:** `Relation[]`

**Relation:**
```typescript
interface Relation {
  id: string;
  fromEntity: Entity;
  toEntity: Entity;
  type: RelationType;
  confidence: number;         // 0.0-1.0
  sourceMessageId?: string;
  createdAt: string;
}
```

**Example:**
```typescript
const relations = await qm.getRelations('session-123', {
  type: 'knows'
});

relations.forEach(r => {
  console.log(`${r.fromEntity.name} knows ${r.toEntity.name} (${r.confidence})`);
});
// Output:
// John knows Quantum Memory (0.85)
```

---

### 4.3 searchEntities

Search entities by name.

```typescript
async searchEntities(query: string, sessionId?: string): Promise<Entity[]>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| sessionId | string | No | Limit to session |

**Returns:** `Entity[]`

**Example:**
```typescript
const entities = await qm.searchEntities('quantum');
// Returns all entities matching 'quantum'
```

---

## 5. Search API

### 5.1 search

Full-text and semantic search.

```typescript
async search(query: string, options?: SearchOptions): Promise<SearchResult[]>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| options | SearchOptions | No | Search options |

**SearchOptions:**
```typescript
interface SearchOptions {
  sessionId?: string;         // Limit to session
  projectId?: string;         // Limit to project
  dateFrom?: string;          // ISO date string
  dateTo?: string;           // ISO date string
  types?: MessageType[];     // Filter by message type
  limit?: number;            // Max results (default: 20)
  offset?: number;           // Pagination offset
}
```

**MessageType:**
```typescript
type MessageType = 'user' | 'assistant' | 'system';
```

**Returns:** `SearchResult[]`

**SearchResult:**
```typescript
interface SearchResult {
  id: string;
  sessionId: string;
  content: string;
  role: string;
  score: number;            // Relevance score 0.0-1.0
  highlights: string[];      // Matching snippets
  timestamp: string;
}
```

**Example:**
```typescript
const results = await qm.search('quantum memory', {
  sessionId: 'session-123',
  limit: 10
});

results.forEach(r => {
  console.log(`[${r.score.toFixed(2)}] ${r.content.substring(0, 80)}...`);
});
```

---

## 6. Project API

### 6.1 createProject

Create a new project.

```typescript
async createProject(name: string): Promise<Project>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Project name |

**Returns:**
```typescript
interface Project {
  id: string;
  name: string;
  createdAt: string;
  lastAccessed: string;
}
```

**Example:**
```typescript
const project = await qm.createProject('Work Project Alpha');
console.log(project.id);  // 'project-abc-123'
```

---

### 6.2 listProjects

List all projects.

```typescript
async listProjects(): Promise<Project[]>
```

**Returns:** `Project[]`

**Example:**
```typescript
const projects = await qm.listProjects();
projects.forEach(p => console.log(`${p.name} (${p.id})`));
```

---

### 6.3 getProject

Get project details.

```typescript
async getProject(projectId: string): Promise<ProjectDetails>
```

**Returns:**
```typescript
interface ProjectDetails extends Project {
  sessionCount: number;
  messageCount: number;
  entityCount: number;
  createdAt: string;
  lastAccessed: string;
}
```

---

### 6.4 deleteProject

Delete a project and all associated data.

```typescript
async deleteProject(projectId: string, options?: DeleteOptions): Promise<boolean>
```

**DeleteOptions:**
```typescript
interface DeleteOptions {
  archive?: boolean;          // Archive before delete (default: true)
}
```

---

### 6.5 setActiveProject

Set the active project for subsequent operations.

```typescript
setActiveProject(projectId: string): void
```

**Example:**
```typescript
qm.setActiveProject('project-123');
// All subsequent operations scoped to project-123
```

---

### 6.6 getActiveProject

Get current active project.

```typescript
getActiveProject(): string | null
```

---

## 7. Configuration API

### 7.1 getConfig

Get current configuration.

```typescript
getConfig(): QuantumConfig
```

**Returns:**
```typescript
interface QuantumConfig {
  dag: DAGConfig;
  entities: EntityConfig;
  knowledgeGraph: KGConfig;
  autoRecall: RecallConfig;
  projects: ProjectConfig;
  smartDrop: DropConfig;
}
```

---

### 7.2 updateConfig

Update configuration.

```typescript
updateConfig(updates: Partial<QuantumConfig>): void
```

**Example:**
```typescript
qm.updateConfig({
  dag: { freshTailCount: 50 },
  autoRecall: { budget: 'high' }
});
```

---

## 8. Data Types

### 8.1 Message

```typescript
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}
```

### 8.2 Summary

```typescript
interface Summary {
  id: string;
  sessionId: string;
  parentId?: string;
  level: number;              // 0 = leaf, 1 = condensed, 2+ = higher
  content: string;
  sourceMessageIds: string[];
  sourceSummaryIds: string[];
  tokens: number;
  modelUsed?: string;
  createdAt: string;
}
```

### 8.3 MemoryInject

```typescript
interface MemoryInject {
  id: string;
  sessionId: string;
  content: string;
  sourceIds: string[];
  injectedAt: string;
  wasUseful?: boolean;
}
```

### 8.4 DropRecord

```typescript
interface DropRecord {
  id: string;
  sessionId: string;
  messageIds: string[];
  reason: 'low_importance' | 'redundancy' | 'age';
  droppedAt: string;
}
```

---

## Error Responses

All methods may throw:

```typescript
interface QuantumError {
  code: string;       // Error code
  message: string;    // Human-readable message
  details?: any;      // Additional context
}
```

**Error Codes:**

| Code | Description |
|------|-------------|
| NOT_FOUND | Requested resource not found |
| VALIDATION_ERROR | Invalid parameters |
| DATABASE_ERROR | SQLite error |
| LLM_ERROR | Summarization failed |
| CONFIG_ERROR | Invalid configuration |

---

**End of API Specification**

*Document prepared for Quantum Memory implementation*
