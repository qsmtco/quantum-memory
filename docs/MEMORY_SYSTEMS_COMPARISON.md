# Deep Dive: Agent Memory Systems for OpenClaw

**Date:** 2026-03-14  
**Purpose:** Comprehensive comparison of memory solutions

---

## Executive Summary

There are **five main approaches** to agent memory in the OpenClaw ecosystem:

| Solution | Type | Storage | LLM Summarization | Search | Complexity |
|----------|------|---------|-------------------|--------|------------|
| **lossless-claw** | Context Engine | SQLite | ✅ Real DAG | Built-in | High |
| **MemOS Cloud** | Hooks | External API | ✅ Cloud | Built-in | Low |
| **Hindsight** | Context Engine | SQLite | ✅ | Built-in | Medium |
| **quantum-memory** | Context Engine | JSONL | ❌ Extractive only | Built-in | Low |
| **Default OpenClaw** | Built-in | Memory | ❌ Truncation | ❌ | Minimal |

**Recommendation:** For production use, **lossless-claw** is the best choice.

---

## GPTDisk / MeGPT Approach

**Also known as:** MeGPT, file-per-turn memory

This approach gained popularity from a Reddit post where someone made ChatGPT store memories as a virtual file system.

### What It Does

| Feature | Description |
|---------|-------------|
| **File-per-turn** | Each conversation turn becomes a markdown file |
| **Virtual file system** | AI can "walk" through files to get context |
| **Project-based** | Different folders for different projects |
| **Summaries** | Great at summarizing "what did I work on in project X?" |

### What It Does Well

| What | Why It's Good |
|------|---------------|
| **Simple** | No database, just files in folders |
| **Human-readable** | You can open and read the files |
| **Project isolation** | Separate folders = separate contexts |
| **Summarization** | Can ask "summarize project X" and it works |
| **Portable** | Just copy the folder |

### Example Structure

```
/memory
  /project-alpha
    2024-12-01.md   (first chat about alpha)
    2024-12-05.md   (follow-up)
    2024-12-15.md   (latest)
  /project-beta
    ...
```

Ask: "What did I work on in project alpha?" → AI reads the files → gives you a summary.

### What's Not Great

| Limitation | Impact |
|------------|--------|
| Doesn't scale | 1000+ files = slow |
| No search | Must read all files |
| No compression | Files keep growing |
| Manual organization | You must create folders |

### What We Borrowed

The file-per-turn idea went into quantum-memory's daily notes (one file per day).

---

## LangChain Memory Patterns

**Website:** https://python.langchain.com/docs/modules/memory/

LangChain offers multiple memory patterns. Here's what they do well:

### Memory Types

| Memory Type | What It Does |
|-------------|--------------|
| **ConversationBuffer** | Stores all messages verbatim |
| **ConversationSummary** | LLM summarizes conversation |
| **ConversationBufferWindow** | Keeps last N messages |
| **ConversationTokenBuffer** | Keeps last N tokens |
| **ConversationEntity** | Extracts named entities |
| **KnowledgeGraph** | Builds relationships between entities |

### What LangChain Does Well

| Feature | Description |
|---------|-------------|
| **Entity extraction** | Automatically pulls names, places, concepts from conversation |
| **Knowledge graph** | Maps relationships ("A knows B", "X depends on Y") |
| **Multiple backends** | In-memory, Redis, SQL, vector stores |
| **Swappable architecture** | Swap memory type without changing code |
| **RAG integration** | Vector store retrieval for long-term memory |

### The Key Insight

LangChain showed that memory isn't one-size-fits-all:

```
Short-term:  Buffer window (last N messages)
     │
     ▼
Medium-term: Entity extraction (who, what, where)
     │
     ▼
Long-term:   Vector store + RAG (semantic search)
```

### What We Borrowed

The entity extraction idea went into quantum-memory's indexer.

### What's Better in lossless-claw

LangChain memory is per-conversation. lossless-claw is per-session with DAG - more sophisticated for agent use.

---

## What is a DAG?

**DAG = Directed Acyclic Graph**

In memory systems, a DAG structures summaries as a hierarchy:

```
                    ┌──────────────────┐
                    │  Recent Messages  │ (last 32 - protected)
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Leaf Summary    │ (messages 33-1000)
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Condensed Summary │ (group of leafs)
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Higher Summary   │ (group of condensed)
                    └──────────────────┘
```

**Why DAG beats flat summarization:**

| Flat Summaries | DAG |
|---------------|-----|
| Loses which messages formed which summary | Tracks lineage (which events → which summary) |
| Can't drill back into details | Can expand any node to see source |
| One level of compression | Unlimited depth |

**Example:** 10,000 messages → 50 leaf summaries → 5 condensed summaries → 1 top summary

If you ask "what happened in week 1?", it can expand the relevant leaf and show you the original messages. It's like a family tree of summaries.

---

## OpenHands: The Originator

**Repository:** https://github.com/All-Hands-AI/OpenHands

### What OpenHands Does Well

| Feature | Description |
|---------|-------------|
| **Event architecture** | Every action is logged as an event - commands, edits, results |
| **Memory condensation** | Drops old events, summarizes the rest |
| **Task-oriented memory** | Hierarchical approach for complex, long-running tasks |
| **Conversation memory** | Tracks context across turns |
| **Source traceability** | Knows where information came from |

### The Key Innovation

OpenHands pioneered the **condensation** concept:

1. Keep recent messages in full
2. Compress older messages into summaries
3. When summaries grow too large, compress them further
4. Always preserve the key information

This is the foundation that lossless-claw improved with DAG structure.

---

## 1. lossless-claw (Recommended)

**Repository:** https://github.com/Martian-Engineering/lossless-claw

### Overview
Lossless Context Management (LCM) plugin for OpenClaw. Based on academic research. Replaces built-in sliding-window compaction with DAG-based summarization.

### Key Features

1. **DAG-Based Summarization**
   - Messages organized as directed acyclic graph
   - Leaf summaries → condensed summaries → higher-level nodes
   - Nothing lost - every message preserved

2. **Real LLM Summarization**
   - Uses your configured OpenClaw LLM
   - Configurable: leaf chunks, condensed targets
   - Token limits: 20K source → 1.2K leaf, 2K condensed

3. **Built-in Search Tools**
   - `lcm_grep` - search compacted history
   - `lcm_describe` - explore summaries
   - `lcm_expand` - drill into summaries to recover detail

4. **Auto-Compaction**
   - Triggers at 75% context threshold (configurable)
   - Protects last 32 messages (fresh tail)
   - Cascades DAG as needed

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Core                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              LCM Context Engine (lossless-claw)            │
├─────────────────────────────────────────────────────────────┤
│  engine.ts        - ContextEngine interface implementation │
│  assembler.ts     - Assembles summaries + messages         │
│  compaction.ts    - Leaf passes, condensation, sweeps     │
│  summarize.ts     - LLM prompt generation                │
│  retrieval.ts     - grep, describe, expand operations    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Database                          │
│  - conversation-store.ts  - Message persistence           │
│  - summary-store.ts      - DAG persistence               │
│  - fts5 (optional)       - Full-text search             │
└─────────────────────────────────────────────────────────────┘
```

### Configuration

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "lossless-claw"
    }
  }
}
```

**Environment Variables:**
- `LCM_CONTEXT_THRESHOLD` - 0.75 (triggers at 75% context)
- `LCM_FRESH_TAIL_COUNT` - 32 (protected messages)
- `LCM_LEAF_CHUNK_TOKENS` - 20000
- `LCM_LEAF_TARGET_TOKENS` - 1200
- `LCM_CONDENSED_TARGET_TOKENS` - 2000
- `LCM_INCREMENTAL_MAX_DEPTH` - -1 (unlimited cascade)

### Pros
- ✅ Nothing lost - full history preserved
- ✅ Real LLM summarization
- ✅ DAG provides context lineage
- ✅ Built-in search tools
- ✅ Production-tested

### Cons
- ❌ SQLite dependency
- ❌ More complex
- ❌ Requires LLM for summarization

### Install
```bash
openclaw plugins install @martian-engineering/lossless-claw
```

---

## 2. MemOS Cloud

**Repository:** https://github.com/MemTensor/MemOS-Cloud-OpenClaw-Plugin

### Overview
Official MemTensor plugin. Uses OpenClaw lifecycle hooks to sync with MemOS Cloud service.

### Key Features

1. **Cloud-Based Memory**
   - Stores memories on MemOS Cloud
   - Cross-session, cross-device access
   - Managed service

2. **Lifecycle Integration**
   - `before_agent_start` → recall memories
   - `agent_end` → save new messages

3. **Multi-Agent Support**
   - Isolated memory per agent
   - Agent ID tracking

4. **Optional Filtering**
   - Model-based recall filtering
   - Local LLM (Ollama) supported

### Architecture

```
OpenClaw Lifecycle
       │
       ├── before_agent_start ──→ /search/memory ──→ Inject recall
       │
       └── agent_end ──────────→ /add/message ──────→ Save to cloud
```

### Configuration

```bash
# Required
MEMOS_API_KEY=your_key

# Optional
MEMOS_BASE_URL=https://memos.memtensor.cn/api/openmem/v1
MEMOS_USER_ID=your_user
MEMOS_RECALL_GLOBAL=true
```

### Pros
- ✅ Cross-device sync
- ✅ Managed service (no maintenance)
- ✅ Multi-agent isolation
- ✅ Simple setup

### Cons
- ❌ Data leaves your machine
- ❌ Requires internet
- ❌ Third-party dependency

### Install
```bash
openclaw plugins install @memtensor/memos-cloud-openclaw-plugin@latest
```

---

## 3. Hindsight

**Repository:** https://github.com/vectorize/hindsight

### Overview
From the makers of Hindsight. Memory system with SQLite storage and LLM summarization. Similar to lossless-claw.

### Key Features
- SQLite-based persistence
- LLM summarization
- DAG compaction
- Full-text search (FTS5)
- Agent tools for recall

### Comparison to lossless-claw
| Feature | Hindsight | lossless-claw |
|---------|-----------|---------------|
| Storage | SQLite | SQLite |
| LLM | ✅ | ✅ |
| DAG | ✅ | ✅ |
| Search | FTS5 | Optional FTS5 |
| Tools | grep, expand | lcm_grep, lcm_expand |

---

## 4. quantum-memory (What We Built)

### Overview
File-based memory system with event streaming. Built during this session.

### Key Features

1. **Append-Only Event Stream**
   - JSONL files per day
   - Immutable source of truth
   - fsync for durability

2. **Session Management**
   - Dual-write (session + daily)
   - Crash detection
   - Recovery from daily stream

3. **Full-Text Search**
   - Inverted index
   - Entity extraction
   - Sub-200ms queries

4. **Daily Notes**
   - Auto-generated markdown
   - Timeline + facts

5. **Condensation (Basic)**
   - Extractive summarization (NOT LLM)
   - Archive old sessions
   - LTM proposals

### Architecture

```
QuantumMemory (plugin.js)
├── EventWriter → daily JSONL
├── EventReader ← daily JSONL
├── SessionManager
│   ├── createSession()
│   ├── appendToSession()
│   ├── completeSession()
│   └── recoverSession()
├── Indexer (search)
├── Condenser (compression)
└── NoteGenerator (daily docs)
```

### Performance
- Write: ~187 events/sec
- Read: ~5ms
- Search: ~11ms

### Pros
- ✅ No external dependencies
- ✅ Simple file-based
- ✅ Fast search
- ✅ Audit trail (JSONL)
- ✅ Easy to understand

### Cons
- ❌ Extractive summarization only (NOT LLM)
- ❌ No DAG
- ❌ Basic "self-improvement" (not implemented)
- ❌ Less sophisticated than lossless-claw

---

## 5. Default OpenClaw Memory

### Overview
Built-in sliding window compaction. Simplest option - no plugins needed.

### How It Works
- Keeps last N messages in context
- Drops older messages entirely
- No persistence between sessions (without hooks)

### Pros
- ✅ Zero setup
- ✅ No dependencies

### Cons
- ❌ Messages lost after window
- ❌ No long-term memory
- ❌ Context resets each session

---

## Comparison Matrix

| Feature | lossless-claw | MemOS Cloud | Hindsight | quantum-memory | Default |
|---------|--------------|-------------|-----------|---------------|---------|
| **Type** | Context Engine | Hooks | Context Engine | Context Engine | Built-in |
| **Storage** | SQLite | Cloud API | SQLite | JSONL | Memory |
| **LLM Summarization** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **DAG** | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Search** | Built-in | Built-in | Built-in | Built-in | ❌ |
| **Cross-Device** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Setup** | Medium | Easy | Medium | Easy | Trivial |
| **Data Location** | Local | Cloud | Local | Local | N/A |

---

## Recommendations

### For Production Use
**Use lossless-claw**
- Best features (DAG, LLM, search)
- Local storage (data stays with you)
- Production-tested

### For Cross-Device
**Use MemOS Cloud**
- Sync across devices
- Managed service
- Simple setup

### For Learning/Development
**Use quantum-memory**
- Simple to understand
- File-based (easy to inspect)
- Good starting point for modifications

### For Minimal Setup
**Use Default**
- No plugins needed
- Works out of the box

---

## Key Takeaways

1. **lossless-claw is the gold standard** for local, sophisticated memory
2. **MemOS Cloud** is best for cross-device sync
3. **quantum-memory** is simple but lacks real LLM summarization
4. The "self-improving" in quantum-memory was design, not implementation

---

*Document compiled: 2026-03-14*
