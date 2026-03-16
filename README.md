# Quantum Memory

A hybrid memory system for OpenClaw that combines DAG-based compaction, entity extraction, knowledge graphs, and auto-recall into a unified SQLite-backed solution.

## Features

- **DAG Compaction** — Hierarchical summarization preserving all context
- **Entity Extraction** — Track persons, projects, tools, concepts
- **Knowledge Graphs** — Map relationships between entities
- **Auto-Recall** — Intelligently inject relevant memories
- **Full-Text Search** — Keyword + semantic search
- **Smart Dropping** — Auto-remove low-value content

## Installation

```bash
npm install
npm run build
```

## OpenClaw Setup

### 1. Local Plugin (Development)

In your OpenClaw config (`openclaw.yaml`):

```yaml
plugins:
  entries:
    quantum-memory:
      enabled: true
      path: /path/to/quantum-memory-v2
```

### 2. Configure Context Engine

```yaml
context:
  engine: quantum-memory
```

### 3. Configuration

Add to your `openclaw.yaml`:

```yaml
plugins:
  entries:
    quantum-memory:
      config:
        databasePath: "~/.openclaw/quantum.db"
        freshTailCount: 32
        contextThreshold: 0.75
        leafChunkTokens: 20000
        leafTargetTokens: 1200
        condensedTargetTokens: 2000
```

### 4. Via OpenClaw CLI (future)

```bash
openclaw plugin install quantum-memory
```

---

## Quick Start

```typescript
import { QuantumDatabase } from './src/db/Database.js';
import { SessionManager } from './src/engine/SessionManager.js';
import { MessageStore } from './src/engine/MessageStore.js';
import { ContextStore } from './src/engine/ContextStore.js';

// Initialize
const db = new QuantumDatabase({ databasePath: '~/.openclaw/quantum.db' });
db.initialize();

const sessionMgr = new SessionManager(db);
const msgStore = new MessageStore(db);
const ctxStore = new ContextStore(msgStore, sessionMgr, summaryStore);

// Create session and store messages
const session = sessionMgr.create('my-project');
msgStore.create(session.id, 'user', 'Hello world');

// Retrieve context
const context = ctxStore.getContext(session.id, { maxTokens: 8000 });
console.log(context.items);
```

## Architecture

```
┌─────────────────────────────────────┐
│         OpenClaw Interface          │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         QuantumEngine                │
└─────────────┬───────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐
│  DAG  │ │Entity │ │Recall │
│Compactor│ │Extractor│ │Injector│
└───┬───┘ └───┬───┘ └───┬───┘
    └─────────┼─────────┘
              ▼
┌─────────────────────────────────────┐
│         SQLite (better-sqlite3)      │
└─────────────────────────────────────┘
```

## API

### Core Classes

| Class | Description |
|-------|-------------|
| `QuantumDatabase` | SQLite connection & schema |
| `SessionManager` | Session lifecycle |
| `MessageStore` | Message persistence |
| `SummaryStore` | DAG summaries |
| `EntityStore` | Entity extraction |
| `RelationStore` | Knowledge graph |
| `SearchEngine` | Full-text + semantic search |
| `AutoRecallInjector` | Memory injection |
| `SmartDropper` | Low-value content removal |
| `ProjectManager` | Project CRUD |
| `QuantumContextEngine` | Main context engine (implements ContextEngine interface) |
| `EntityExtractor` | Pattern-based entity extraction from text |
| `LLMCaller` | Wrapper for calling LLMs via OpenClaw tools |

### Utilities

#### EntityExtractor

Extracts entities (persons, projects, tools, concepts) from text using pattern matching:

```typescript
import { extractEntities } from './src/utils/EntityExtractor.js';

const result = extractEntities('John is working on Quantum using Python');
// result.entities: [{name: 'John', type: 'person', confidence: 0.3}, ...]
// result.relations: [{from: 'John', to: 'Quantum', type: 'works_on'}, ...]
```

#### LLMCaller

Wrapper for calling LLMs through OpenClaw's tool system:

```typescript
import { LLMCaller } from './src/utils/LLMCaller.js';

const llm = new LLMCaller(ctx.tools); // Pass OpenClaw tools
const response = await llm.chat([
  { role: 'user', content: 'Summarize this...' }
]);
const summary = response.content;
```

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Configuration

```json
{
  "quantumMemory": {
    "databasePath": "~/.openclaw/quantum.db",
    "freshTailCount": 32,
    "contextThreshold": 0.75,
    "leafChunkTokens": 20000,
    "leafTargetTokens": 1200,
    "condensedTargetTokens": 2000
  }
}
```

## License

MIT

## Verification

### Health Check CLI

```bash
npm run health
# or
node dist/cli/health.js
```

**Output:**
```
🧠 Quantum Memory Diagnostics

════════════════════════════════════════

⚠️ Overall Status: WARN

📋 Health Checks:
   ✅ database: ok - Connected successfully
   ✅ schema: ok - All tables present
   ✅ writes: ok
   ⚠️ sessions: warn - No sessions yet

📊 Statistics:
   Sessions:   0
   Messages:   0
   Summaries:  0
   Entities:   0
   Relations: 0
   Projects:   0
```

### Manual Checks

**Check database created:**
```bash
ls -la ~/.openclaw/quantum.db
```

**Query directly:**
```bash
sqlite3 ~/.openclaw/quantum.db "SELECT COUNT(*) FROM sessions;"
```
