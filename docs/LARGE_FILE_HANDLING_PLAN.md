# Quantum Memory - Large File Handling Implementation Plan

## Overview

Large file handling optimizes message storage when content exceeds token thresholds. Instead of storing massive file contents, we summarize and store references — dramatically reducing token usage while preserving the ability to expand on demand.

**Reference:** Based on lossless-claw's `large-files.ts` implementation, enhanced with Quantum Memory improvements.

---

## Phase 1: Core Infrastructure
**Priority:** Critical | **Duration:** Medium

### Step 1.1: Create large-files module
- [ ] Create `src/utils/large-files.ts`
- [ ] Add `FILE_BLOCK_RE` regex for `<file>` tag detection
- [ ] Add `FileBlock` interface with fullMatch, attributes, text, etc.
- [ ] Add `parseFileBlocks()` function

### Step 1.2: File type classification
- [ ] Add `CODE_EXTENSIONS` Set (.js, .ts, .py, .go, .rs, etc.)
- [ ] Add `STRUCTURED_EXTENSIONS` Set (.json, .csv, .xml, .yaml)
- [ ] Add MIME type mapping
- [ ] Add `isCode()`, `isStructured()`, `isText()` classifiers
- [ ] Add `detectFileType()` function

### Step 1.3: Token-based thresholding
- [ ] Add `LARGE_FILE_TOKEN_THRESHOLD` constant (25K tokens)
- [ ] Add token counting utility using tiktoken or similar
- [ ] Add `shouldSummarize()` function (checks if content exceeds threshold)
- [ ] Add configuration option `largeFileThreshold` (default: 25000)

---

## Phase 2: Summarization Strategies
**Priority:** High | **Duration:** Medium

### Step 2.1: JSON summarization
- [ ] Add `exploreJson()` function
- [ ] Parse JSON and describe shape (objects, arrays, keys)
- [ ] Include sample values for first 3 items
- [ ] Handle nested structures up to depth 2

### Step 2.2: CSV/TSV summarization
- [ ] Add `exploreDelimited()` function
- [ ] Extract headers and row count
- [ ] Sample first data row
- [ ] Detect delimiter type automatically

### Step 2.3: XML summarization
- [ ] Add `exploreXml()` function
- [ ] Detect root element
- [ ] List child elements (top 30)
- [ ] Handle attributes

### Step 2.4: Code summarization
- [ ] Add `exploreCode()` function
- [ ] Count lines of code
- [ ] Extract imports/requires
- [ ] List functions/classes (basic regex)
- [ ] Detect language from extension

### Step 2.5: Text summarization
- [ ] Add `exploreText()` function
- [ ] First N characters / last N characters
- [ ] Header detection (markdown headings)
- [ ] Fallback: first + last 100 lines

---

## Phase 3: LLM Integration
**Priority:** High | **Duration:** Medium

### Step 3.1: Summarizer interface
- [ ] Add `TextSummarizer` interface
- [ ] Add `createSummarizer()` factory
- [ ] Support OpenClaw LLM tools

### Step 3.2: LLM-based summarization
- [ ] Add `summarizeWithLLM()` function
- [ ] Build prompt with file metadata
- [ ] Handle LLM failures gracefully (fallback to deterministic)
- [ ] Add config: `largeFileSummaryModel`, `largeFileSummaryProvider`

### Step 3.3: Hybrid approach
- [ ] Try LLM first if available
- [ ] Fallback to deterministic if LLM fails
- [ ] Cache successful summaries

---

## Phase 4: Storage & References
**Priority:** High | **Duration:** Medium

### Step 4.1: Large files table
- [ ] Add `large_files` table to schema:
  ```sql
  CREATE TABLE large_files (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    file_id TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT,
    original_size INTEGER,
    summary TEXT,
    token_count INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```

### Step 4.2: Reference formatting
- [ ] Add `formatFileReference()` function
- [ ] Output: `[QM File: file_id | name | mime | size bytes]`
- [ ] Include exploration summary below

### Step 4.3: Message interception
- [ ] Modify `MessageStore.create()` to detect large files
- [ ] Extract file blocks before storing
- [ ] Store originals in large_files table
- [ ] Replace with references in message

---

## Phase 5: Expansion (On-Demand)
**Priority:** Medium | **Duration:** Medium

### Step 5.1: Expansion detection
- [ ] Add `detectFileReferences()` function
- [ ] Regex to find `[QM File: ...]` patterns
- [ ] Extract file_id from reference

### Step 5.2: Expansion query
- [ ] Add `expandFileReference()` function
- [ ] Look up file_id in large_files table
- [ ] Return original content or summary

### Step 5.3: Expand tool
- [ ] Add `qm_expand` tool (similar to lossless-claw)
- [ ] Input: file_id or message_id
- [ ] Returns original content

---

## Phase 6: Caching & Optimization
**Priority:** Medium | **Duration:** Low

### Step 6.1: Summary caching
- [ ] Add `summary_cache` table:
  ```sql
  CREATE TABLE summary_cache (
    content_hash TEXT PRIMARY KEY,
    summary TEXT,
    token_count INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```
- [ ] Check cache before LLM call
- [ ] Store new summaries in cache

### Step 6.2: Parallel processing
- [ ] Detect multiple files in single message
- [ ] Process summaries in parallel (Promise.all)
- [ ] Add config: `maxParallelSummaries` (default: 5)

### Step 6.3: Incremental processing
- [ ] For very large files (>100K tokens)
- [ ] Summarize in chunks
- [ ] Combine chunk summaries

---

## Phase 7: Configuration & Defaults
**Priority:** Low | **Duration:** Low

### Step 7.1: Config options
- [ ] Add to `QuantumMemoryConfig`:
  ```typescript
  largeFileEnabled: boolean;        // default: true
  largeFileThreshold: number;        // default: 25000
  largeFileSummaryModel?: string;
  largeFileSummaryProvider?: string;
  maxParallelSummaries: number;      // default: 5
  ```

### Step 7.2: Environment variables
- [ ] QM_LARGE_FILE_ENABLED
- [ ] QM_LARGE_FILE_THRESHOLD
- [ ] QM_LARGE_FILE_SUMMARY_MODEL
- [ ] QM_LARGE_FILE_SUMMARY_PROVIDER

### Step 7.3: UI hints
- [ ] Add to `openclaw.plugin.json` uiHints section

---

## Phase 8: Testing
**Priority:** High | **Duration:** Medium

### Step 8.1: Unit tests - Parsing
- [ ] `test_parse_file_blocks_basic` - Simple file block
- [ ] `test_parse_file_blocks_attributes` - With name, mime attributes
- [ ] `test_parse_file_blocks_multiple` - Multiple files in content
- [ ] `test_parse_file_blocks_nested` - Nested file tags

### Step 8.2: Unit tests - Classification
- [ ] `test_is_code_javascript` - JS detected as code
- [ ] `test_is_code_typescript` - TS detected as code
- [ ] `test_is_structured_json` - JSON detected as structured
- [ ] `test_is_structured_csv` - CSV detected as structured

### Step 8.3: Unit tests - Summarization
- [ ] `test_summarize_json_object` - JSON object shape
- [ ] `test_summarize_json_array` - JSON array shape
- [ ] `test_summarize_csv` - CSV headers and row count
- [ ] `test_summarize_code` - Code file functions/imports
- [ ] `test_summarize_text` - Plain text first/last lines

### Step 8.4: Integration tests
- [ ] `test_large_file_intercept` - Message with large file gets summarized
- [ ] `test_large_file_reference` - Reference stored correctly
- [ ] `test_large_file_expand` - Expansion returns original
- [ ] `test_large_file_cache` - Cached summary used on second call

### Step 8.5: Edge cases
- [ ] `test_empty_file_block` - Empty file content
- [ ] `test_malformed_file_block` - Invalid XML in file
- [ ] `test_llm_failure_fallback` - Falls back to deterministic on LLM error
- [ ] `test_no_large_files` - Normal message not affected

---

## Implementation Order

```
Phase 1 (Core)
    ↓
Phase 2 (Summarization)
    ↓
Phase 3 (LLM)
    ↓
Phase 4 (Storage)
    ↓
Phase 5 (Expansion)
    ↓
Phase 6 (Caching)
    ↓
Phase 7 (Config)
    ↓
Phase 8 (Testing)
```

---

## Key Differences from Lossless-Claw

| Feature | Lossless-Claw | Quantum Memory (Our Version) |
|---------|---------------|------------------------------|
| Threshold | Characters (25K) | Tokens (25K) — more accurate |
| Classification | Code/Structured/Text | Same + better MIME detection |
| Caching | None | SQLite cache table |
| Parallel | Sequential | Parallel (configurable) |
| Expansion | Complex tool | Simple qm_expand |
| Config | Env only | Env + plugin config + uiHints |

---

## Success Criteria

- [ ] Messages >25K tokens are summarized automatically
- [ ] File references are stored and expandable
- [ ] LLM summarization works with fallback
- [ ] Summaries are cached for performance
- [ ] All 20+ tests pass
- [ ] Configuration works via env, config, and UI

---

*Plan created: 2026-03-18*
*Based on lossless-claw large-files.ts analysis + Quantum Memory improvements*
