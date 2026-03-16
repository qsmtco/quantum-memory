# Quantum Memory - CLI Tools

**Document ID:** QM-CLI-001  
**Version:** 1.0  
**Date:** 2026-03-14  
**Project:** Quantum Memory - Hybrid Memory System

---

## Table of Contents

1. [Overview](#1-overview)
2. [Command Structure](#2-command-structure)
3. [Session Commands](#3-session-commands)
4. [Data Commands](#4-data-commands)
5. [Maintenance Commands](#5-maintenance-commands)
6. [Utility Commands](#6-utility-commands)

---

## 1. Overview

### 1.1 Purpose

The Quantum Memory CLI provides command-line tools for managing Quantum Memory sessions, data, and maintenance operations. It enables operators to debug, import/export data, run manual compaction, and perform administrative tasks without writing code.

### 1.2 Installation

```bash
# As part of quantum-memory package
npm install quantum-memory

# CLI available as
npx quantum-memory <command>
# or
quantum-memory <command>
```

### 1.3 Global Options

| Option | Description |
|--------|-------------|
| `--db <path>` | Database path (default: ~/.openclaw/quantum.db) |
| `--config <path>` | Config file path |
| `--json` | Output as JSON |
| `--verbose` | Enable verbose logging |
| `--help` | Show help |

---

## 2. Command Structure

```
quantum-memory <command> [options]

Commands:
  session    Session management
  data       Data import/export
  maintenance Database maintenance
  utils      Utility functions
```

---

## 3. Session Commands

### 3.1 session list

List all sessions.

```bash
quantum-memory session list [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--project <id>` | Filter by project |
| `--status <status>` | Filter by status (active/completed/archived) |
| `--limit <n>` | Max results (default: 50) |
| `--offset <n>` | Pagination offset |

**Example:**
```bash
quantum-memory session list --project work --status active
```

**Output:**
```
┌──────────────────────┬─────────┬─────────┬──────────────────────┐
│ ID                   │ Status  │ Messages│ Started              │
├──────────────────────┼─────────┼─────────┼──────────────────────┤
│ sess_abc123          │ active  │ 142     │ 2026-03-14 10:30    │
│ sess_def456          │ active  │ 89      │ 2026-03-14 09:15    │
└──────────────────────┴─────────┴─────────┴──────────────────────┘
```

---

### 3.2 session show

Show session details.

```bash
quantum-memory session show <session-id> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--include-summaries` | Include DAG summaries |
| `--include-entities` | Include extracted entities |
| `--include-relations` | Include knowledge graph |
| `--limit <n>` | Message limit |

**Example:**
```bash
quantum-memory session show sess_abc123 --include-entities
```

**Output:**
```
Session: sess_abc123
Project: work
Status: active
Messages: 142
Entities: 12
Relations: 8
DAG Depth: 2
Created: 2026-03-14 10:30:00
Last Updated: 2026-03-14 13:00:00

Entities:
- Quantum Memory (project): 5 mentions
- John (person): 3 mentions
- SQLite (concept): 4 mentions

DAG:
- level 0: 1 leaf summary (messages 1-100)
- level 1: 1 condensed summary
```

---

### 3.3 session create

Create a new session.

```bash
quantum-memory session create [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--project <name>` | Associated project |
| `--metadata <json>` | Session metadata |

**Example:**
```bash
quantum-memory session create --project "Work Project"
```

---

### 3.4 session complete

Mark session as completed.

```bash
quantum-memory session complete <session-id>
```

**Example:**
```bash
quantum-memory session complete sess_abc123
```

---

### 3.5 session archive

Archive a session.

```bash
quantum-memory session archive <session-id> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--delete` | Delete instead of archive |

**Example:**
```bash
quantum-memory session archive sess_abc123
```

---

### 3.6 session compact

Manually trigger compaction.

```bash
quantum-memory session compact <session-id> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--force` | Force compaction even if below threshold |
| `--dry-run` | Show what would happen without executing |

**Example:**
```bash
quantum-memory session compact sess_abc123 --dry-run
```

---

## 4. Data Commands

### 4.1 data export

Export session data.

```bash
quantum-memory data export <session-id> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--format <format>` | Format: json, jsonl, markdown (default: json) |
| `--output <path>` | Output file (default: stdout) |
| `--include-summaries` | Include summaries |
| `--include-entities` | Include entities |
| `--include-relations` | Include relations |

**Example:**
```bash
quantum-memory data export sess_abc123 --format markdown --output session.md
```

---

### 4.2 data import

Import data into session.

```bash
quantum-memory data import [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--file <path>` | Input file |
| `--session <id>` | Target session (creates new if missing) |
| `--project <name>` | Associated project |
| `--format <format>` | Format: json, jsonl |

**Example:**
```bash
quantum-memory data import --file backup.jsonl --project "Work"
```

---

### 4.3 data search

Search across sessions.

```bash
quantum-memory data search <query> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--session <id>` | Limit to session |
| `--project <name>` | Limit to project |
| `--limit <n>` | Max results (default: 20) |
| `--context <n>` | Context lines around match |

**Example:**
```bash
quantum-memory data search "quantum memory" --project work --limit 10
```

**Output:**
```
Found 3 matches in sess_abc123:

[1] 2026-03-14 10:45:23 (user)
     "...working on quantum memory implementation..."

[2] 2026-03-14 11:20:15 (assistant)
     "The quantum memory DAG structure handles..."

[3] 2026-03-14 12:05:00 (user)
     "...quantum memory entity extraction..."
```

---

### 4.4 data entities

List entities.

```bash
quantum-memory data entities [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--session <id>` | Filter by session |
| `--project <name>` | Filter by project |
| `--type <type>` | Filter by entity type |
| `--min-mentions <n>` | Minimum mention count |

**Example:**
```bash
quantum-memory data entities --project work --type person
```

---

## 5. Maintenance Commands

### 5.1 maintenance vacuum

Run SQLite VACUUM to reclaim space.

```bash
quantum-memory maintenance vacuum [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--analyze` | Run ANALYZE after vacuum |
| `--dry-run` | Show space that would be reclaimed |

**Example:**
```bash
quantum-memory maintenance vacuum --dry-run
```

---

### 5.2 maintenance check

Check database integrity.

```bash
quantum-memory maintenance check
```

**Example:**
```bash
quantum-memory maintenance check
```

**Output:**
```
Database Integrity Check
========================
Schema version: 5
Tables: 9/9 OK
Indexes: 11/11 OK
Foreign Keys: 18/18 OK
Messages: 1,234 OK
Summaries: 45 OK
Entities: 89 OK
Relations: 156 OK
```

---

### 5.3 maintenance rebuild-indexes

Rebuild all indexes.

```bash
quantum-memory maintenance rebuild-indexes
```

---

### 5.4 maintenance backup

Create backup.

```bash
quantum-memory maintenance backup [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--output <path>` | Backup file path |
| `--compress` | Compress with gzip |

**Example:**
```bash
quantum-memory maintenance backup --output backups/quantum-2026-03-14.db --compress
```

---

### 5.5 maintenance restore

Restore from backup.

```bash
quantum-memory maintenance restore <backup-file>
```

**Warning:** This will overwrite the current database.

---

### 5.6 maintenance stats

Show database statistics.

```bash
quantum-memory maintenance stats
```

**Output:**
```
Quantum Memory Statistics
=========================
Database: ~/.openclaw/quantum.db
Size: 45.2 MB

Sessions:
  Total: 156
  Active: 12
  Completed: 98
  Archived: 46

Messages:
  Total: 45,678
  Compacted: 32,100
  In DAG: 13,578

Summaries:
  Leaf: 89
  Condensed: 12
  Higher: 2

Entities: 1,234
Relations: 3,456

Storage:
  WAL size: 2.1 MB
  Free pages: 1,203
```

---

## 6. Utility Commands

### 6.1 utils token-count

Count tokens in text.

```bash
quantum-memory utils token-count <text>
```

**Example:**
```bash
quantum-memory utils token-count "Hello world, this is a test."
```

---

### 6.2 utils config validate

Validate configuration.

```bash
quantum-memory utils config validate [--config <path>]
```

---

### 6.3 utils schema version

Show schema version.

```bash
quantum-memory utils schema version
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Not found |
| 3 | Invalid arguments |
| 4 | Database error |
| 5 | Config error |

---

**End of CLI Documentation**

*Document prepared for Quantum Memory implementation*
