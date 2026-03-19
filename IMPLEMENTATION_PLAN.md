# Quantum Memory - Implementation Plan
## Context Engine Plugin Integration

**Project:** Quantum Memory V2  
**Location:** `/home/q/.openclaw/workspace-Qaster/projects/quantum-memory-V2/`  
**Goal:** Transform Quantum Memory into a proper OpenClaw context-engine plugin (lossless-claw replacement)

---

## Phase 1: Plugin Manifest & Configuration
**Duration:** Medium  
**Priority:** Critical

### Step 1.1: Expand openclaw.plugin.json
- [ ] Add `kind: "context-engine"`
- [ ] Add `author`, `license`, `repository` fields
- [ ] Add complete `configSchema` (match lossless-claw structure)
- [ ] Add `uiHints` for all config options
- [ ] Add `metadata.openclaw.minVersion`

### Step 1.2: Create plugin entry point
- [ ] Create `src/plugin/index.ts` (following lossless-claw pattern)
- [ ] Export default register function
- [ ] Wire context-engine registration
- [ ] Add tool registrations

### Step 1.3: Config resolution
- [ ] Create `src/db/config.ts` for config parsing
- [ ] Support both plugin config + env vars (like lossless-claw)
- [ ] Validate all config options

---

## Phase 2: Context Engine Implementation
**Duration:** High  
**Priority:** Critical

### Step 2.1: Implement required ContextEngine interface
- [ ] `info` - Engine metadata (id, name, ownsCompaction)
- [ ] `ingest(params)` - Store single message
- [ ] `assemble(params)` - Build context for model run
- [ ] `compact(params)` - DAG summarization logic

### Step 2.2: Implement optional lifecycle methods
- [ ] `bootstrap(params)` - Initialize session state
- [ ] `ingestBatch(params)` - Batch message ingestion
- [ ] `afterTurn(params)` - Post-run persistence
- [ ] `dispose()` - Cleanup on shutdown

### Step 2.3: Connect to existing QuantumEngine
- [ ] Wire existing DAG compactor to context-engine methods
- [ ] Wire entity extraction to ingest
- [ ] Wire knowledge graph to storage
- [ ] Connect auto-recall to assemble

---

## Phase 3: Agent Tools
**Duration:** Medium  
**Priority:** High

### Step 3.1: Create search tools (like lcm_grep)
- [ ] `qm_search` - Full-text search over memory
- [ ] `qm_describe` - Describe DAG structure for a session
- [ ] `qm_expand` - Expand summary to source messages

### Step 3.2: Create entity tools
- [ ] `qm_entities` - List extracted entities
- [ ] `qm_relations` - Show knowledge graph
- [ ] `qm_recall` - Manual memory injection

### Step 3.3: Create project tools
- [ ] `qm_projects` - List/create projects
- [ ] `qm_sessions` - List sessions per project

---

## Phase 4: Missing Features (from Lossless-Claw)
**Duration:** Medium  
**Priority:** Medium

### Step 4.1: Session patterns
- [ ] Implement `ignoreSessionPatterns` - Exclude sessions from storage
- [ ] Implement `statelessSessionPatterns` - Read-only sessions
- [ ] Implement `skipStatelessSessions` - Write control

### Step 4.2: Model/provider overrides
- [ ] Add `summaryModel` config option
- [ ] Add `summaryProvider` config option
- [ ] Add `expansionModel` for sub-agent queries

### Step 4.3: Large file handling
- [ ] Intercept large file blocks (>25K tokens)
- [ ] Store separately with summary
- [ ] Reference in context instead of raw content

---

## Phase 5: Database & Storage
**Duration:** Medium  
**Priority:** High

### Step 5.1: Migration system
- [ ] Create `src/db/migrations/` directory
- [ ] Add schema version tracking
- [ ] Implement migration runner

### Step 5.2: Database connection
- [ ] Create `src/db/connection.ts`
- [ ] Add WAL mode for concurrency
- [ ] Add connection pooling

### Step 5.3: Integrity checks
- [ ] Verify DAG integrity on load
- [ ] Repair broken links
- [ ] Validate summaries

---

## Phase 6: Core Feature Implementation
**Duration:** High  
**Priority:** High

### Step 6.1: DAG Compaction
- [ ] Implement leaf summary generation
- [ ] Implement condensed summary generation
- [ ] Implement hierarchical DAG building
- [ ] Implement incremental compaction

### Step 6.2: Entity Extraction
- [ ] Extract person names
- [ ] Extract project names
- [ ] Extract tool/technology names
- [ ] Extract concepts and decisions

### Step 6.3: Knowledge Graph
- [ ] Detect "knows" relationships
- [ ] Detect "depends_on" relationships
- [ ] Detect "uses" relationships
- [ ] Store with confidence scores

### Step 6.4: Auto-Recall
- [ ] Build recall query from context
- [ ] Search relevant memories
- [ ] Inject into assemble result

### Step 6.5: Smart Dropping
- [ ] Calculate importance scores
- [ ] Detect redundant content
- [ ] Apply age-based dropping

---

## Phase 7: Testing & Quality Assurance
**Duration:** High  
**Priority:** Critical

### Step 7.1: Unit Tests - Core Engine

#### DAG Compaction Tests
- [ ] `test_dag_leaf_creation` - Single leaf summary from N messages
- [ ] `test_dag_condensed_from_leaves` - Condensed from multiple leaves
- [ ] `test_dag_hierarchical_levels` - Multiple hierarchy levels
- [ ] `test_dag_source_tracking` - Sources link back to originals
- [ ] `test_dag_token_budget_respected` - Respects leafChunkTokens config
- [ ] `test_dag_fresh_tail_protection` - Last N messages not compacted
- [ ] `test_dag_empty_session` - Handles empty message list
- [ ] `test_dag_single_message` - Single message doesn't create summary
- [ ] `test_dag_multiple_sessions` - Multiple independent sessions
- [ ] `test_dag_compaction_trigger` - Triggers at correct threshold
- [ ] `test_dag_forced_compaction` - /compact command works
- [ ] `test_dag_incremental_vs_full` - Incremental vs full compaction

#### Entity Extraction Tests
- [ ] `test_entity_person_detection` - Extracts person names
- [ ] `test_entity_project_detection` - Extracts project names
- [ ] `test_entity_tool_detection` - Extracts technologies/frameworks
- [ ] `test_entity_concept_detection` - Extracts abstract concepts
- [ ] `test_entity_decision_detection` - Extracts decisions
- [ ] `test_entity_case_insensitivity` - Case insensitive matching
- [ ] `test_entity_duplicate_tracking` - Tracks mention counts
- [ ] `test_entity_mention_context` - Stores surrounding context
- [ ] `test_entity_custom_types` - Custom entity types work
- [ ] `test_entity_empty_content` - Handles empty messages
- [ ] `test_entity_mixed_content` - Multiple entities in one message

#### Knowledge Graph Tests
- [ ] `test_kg_knows_relation` - Person-to-person "knows"
- [ ] `test_kg_depends_on_relation` - Project dependencies
- [ ] `test_kg_uses_relation` - Tool-to-project usage
- [ ] `test_kg_decided_relation` - Person-decision links
- [ ] `test_kg_confidence_scoring` - Confidence scores stored
- [ ] `test_kg_source_tracking` - Links to source messages
- [ ] `test_kg_bidirectional` - Bidirectional relationship inference
- [ ] `test_kg_empty_graph` - Handles no relationships
- [ ] `test_kg_self_reference` - Handles self-referential entities
- [ ] `test_kg_multiple_relations` - Multiple relations between entities

#### Auto-Recall Tests
- [ ] `test_recall_query_construction` - Builds query from context
- [ ] `test_recall_token_budget` - Respects maxTokens config
- [ ] `test_recall_priority_scoring` - Ranks by relevance
- [ ] `test_recall_injection_format` - Correct injection format
- [ ] `test_recall_empty_context` - Handles no prior context
- [ ] `test_recall_no_matches` - Handles no relevant memories
- [ ] `test_recall_deduplication` - No duplicate injections
- [ ] `test_recall_feedback_loop` - Tracks usefulness

#### Smart Drop Tests
- [ ] `test_drop_importance_scoring` - Calculates importance correctly
- [ ] `test_drop_redundancy_detection` - Detects duplicate content
- [ ] `test_drop_age_threshold` - Drops old unreferenced content
- [ ] `test_drop_logging` - Records dropped content
- [ ] `test_drop_entity_preservation` - Preserves entities from dropped
- [ ] `test_drop_low_importance` - Drops below threshold
- [ ] `test_drop_disabled` - Can disable smart drop

### Step 7.2: Unit Tests - Database & Storage

#### Database Schema Tests
- [ ] `test_db_projects_crud` - Create/read/update/delete projects
- [ ] `test_db_sessions_crud` - Session management
- [ ] `test_db_messages_storage` - Message persistence
- [ ] `test_db_summaries_storage` - Summary storage
- [ ] `test_db_entities_storage` - Entity storage
- [ ] `test_db_relations_storage` - Relation storage
- [ ] `test_db_memory_inject_storage` - Auto-recall cache
- [ ] `test_db_drop_log_storage` - Drop tracking

#### Migration Tests
- [ ] `test_migration_initial_schema` - V1 schema applies
- [ ] `test_migration_sequential` - Multiple migrations in order
- [ ] `test_migration_idempotent` - Running twice doesn't duplicate
- [ ] `test_migration_rollback` - Can rollback if needed
- [ ] `test_migration_integrity` - Data survives migration

#### Integrity Tests
- [ ] `test_integrity_dag_links` - DAG parent/child links valid
- [ ] `test_integrity_foreign_keys` - Foreign key constraints work
- [ ] `test_integrity_orphan_messages` - Detects orphaned records
- [ ] `test_integrity_circular_refs` - No circular references
- [ ] `test_integrity_repair` - Auto-repair机制 works

### Step 7.3: Unit Tests - Configuration

#### Config Tests
- [ ] `test_config_defaults` - Default values applied correctly
- [ ] `test_config_env_override` - Environment variables override config
- [ ] `test_config_plugin_override` - Plugin config takes precedence
- [ ] `test_config_validation` - Invalid config rejected
- [ ] `test_config_missing_required` - Missing required fields caught
- [ ] `test_config_type_coercion` - Types coerced correctly
- [ ] `test_config_unknown_fields` - Unknown fields handled gracefully

### Step 7.4: Integration Tests - Context Engine Lifecycle

#### Lifecycle Tests
- [ ] `test_lifecycle_bootstrap_new_session` - New session initialized
- [ ] `test_lifecycle_bootstrap_existing_session` - Existing session loaded
- [ ] `test_lifecycle_ingest_single` - Single message ingested
- [ ] `test_lifecycle_ingest_batch` - Batch ingestion works
- [ ] `test_lifecycle_assemble_empty` - Assembles empty context
- [ ] `test_lifecycle_assemble_with_messages` - Assembles with messages
- [ ] `test_lifecycle_assemble_respects_budget` - Token budget respected
- [ ] `test_lifecycle_assemble_includes_summaries` - Includes summaries
- [ ] `test_lifecycle_assemble_includes_recall` - Auto-recall injected
- [ ] `test_lifecycle_compact_triggers` - Auto-compaction triggers
- [ ] `test_lifecycle_compact_manual` - Manual /compact works
- [ ] `test_lifecycle_after_turn` - Post-turn processing works
- [ ] `test_lifecycle_dispose` - Cleanup on shutdown
- [ ] `test_lifecycle_subagent_spawn` - Subagent preparation
- [ ] `test_lifecycle_subagent_end` - Subagent cleanup

#### Session Management Tests
- [ ] `test_session_create` - New session created
- [ ] `test_session_complete` - Session marked complete
- [ ] `test_session_archive` - Session archived
- [ ] `test_session_delete` - Session deleted
- [ ] `test_session_restore` - Archived session restored

### Step 7.5: Integration Tests - Tools

#### Tool Tests
- [ ] `test_tool_qm_search_basic` - Basic search works
- [ ] `test_tool_qm_search_empty_query` - Empty query handled
- [ ] `test_tool_qm_search_with_filters` - Filters applied
- [ ] `test_tool_qm_search_ranking` - Results ranked correctly
- [ ] `test_tool_qm_describe_empty` - Describes empty session
- [ ] `test_tool_qm_describe_with_content` - Describes DAG structure
- [ ] `test_tool_qm_expand_summary` - Expands to source
- [ ] `test_tool_qm_expand_depth` - Handles deep expansion
- [ ] `test_tool_qm_entities_list` - Lists entities
- [ ] `test_tool_qm_entities_filter` - Filters by type
- [ ] `test_tool_qm_relations_list` - Lists relations
- [ ] `test_tool_qm_relations_filter` - Filters by type
- [ ] `test_tool_qm_recall_manual` - Manual recall works
- [ ] `test_tool_qm_projects_list` - Lists projects
- [ ] `test_tool_qm_projects_create` - Creates project
- [ ] `test_tool_qm_sessions_list` - Lists sessions

### Step 7.6: Integration Tests - Project Features

#### Project Tests
- [ ] `test_project_create` - Project creation works
- [ ] `test_project_list` - Lists all projects
- [ ] `test_project_delete` - Deletes project and data
- [ ] `test_project_scope` - Queries scoped to project
- [ ] `test_project_auto_detect` - Auto-detects from channel/user
- [ ] `test_project_migration` - Sessions migrate between projects

### Step 7.7: Integration Tests - Session Patterns

#### Pattern Tests
- [ ] `test_pattern_ignore_matched` - Ignored pattern excluded
- [ ] `test_pattern_ignore_not_matched` - Non-matched included
- [ ] `test_pattern_stateless_read` - Read-only session works
- [ ] `test_pattern_stateless_write_blocked` - Write blocked in stateless
- [ ] `test_pattern_glob_matching` - Glob patterns work
- [ ] `test_pattern_priority` - Pattern priority correct

### Step 7.8: Edge Case Tests

#### Edge Cases
- [ ] `test_edge_extremely_long_message` - 100K+ character message
- [ ] `test_edge_extremely_short_message` - Single character message
- [ ] `test_edge_unicode_content` - Unicode/emoji handled
- [ ] `test_edge_binary_content` - Binary in content handled
- [ ] `test_edge_json_content` - JSON in content handled
- [ ] `test_edge_code_blocks` - Code blocks handled
- [ ] `test_edge_markdown` - Markdown handled
- [ ] `test_edge_special_characters` - SQL injection attempts sanitized
- [ ] `test_edge_concurrent_sessions` - 50+ concurrent sessions
- [ ] `test_edge_rapid_ingestion` - 1000+ messages/second
- [ ] `test_edge_database_locked` - Handles database locks
- [ ] `test_edge_disk_full` - Handles disk full scenario
- [ ] `test_edge_memory_pressure` - Handles low memory
- [ ] `test_edge_corrupted_database` - Recovers from corruption

### Step 7.9: Performance Tests

#### Performance Benchmarks
- [ ] `test_perf_ingest_single_message` - <10ms per message
- [ ] `test_perf_assemble_1k_messages` - <100ms for 1K messages
- [ ] `test_perf_compact_10k_messages` - <5s for 10K messages
- [ ] `test_perf_search_fulltext` - <50ms for full-text search
- [ ] `test_perf_entity_extraction` - <5ms per message
- [ ] `test_perf_graph_queries` - <20ms for graph queries
- [ ] `test_perf_memory_1m_messages` - Handles 1M message session
- [ ] `test_perf_concurrent_reads` - 100 concurrent reads
- [ ] `test_perf_concurrent_writes` - 50 concurrent writes

### Step 7.10: Error Handling Tests

#### Error Tests
- [ ] `test_error_invalid_session_id` - Invalid session handled
- [ ] `test_error_database_connection_failed` - Connection failure handled
- [ ] `test_error_llm_summarization_failed` - Summarization failure handled
- [ ] `test_error_entity_extraction_failed` - Entity extraction failure handled
- [ ] `test_error_config_invalid` - Invalid config error
- [ ] `test_error_tool_not_found` - Tool not found handled
- [ ] `test_error_permission_denied` - Permission errors handled
- [ ] `test_error_disk_full` - Disk full error handled
- [ ] `test_error_timeout_long_operation` - Long operation timeout

### Step 7.11: End-to-End User Scenarios

#### Scenario Tests
- [ ] `test_e2e_single_user_conversation` - 100 message conversation
- [ ] `test_e2e_multi_session_continuity` - Continuity across sessions
- [ ] `test_e2e_compaction_recovery` - Recovers context after compaction
- [ ] `test_e2e_search_and_expand` - Search + expand workflow
- [ ] `test_e2e_entity_tracking` - Entity tracking over time
- [ ] `test_e2e_project_isolation` - Projects properly isolated
- [ ] `test_e2e_tool_usage_in_conversation` - Tools used in real conversation
- [ ] `test_e2e_heartbeat_continuity` - Works across heartbeats
- [ ] `test_e2e_restart_persistence` - Data survives restart
- [ ] `test_e2e_plugin_reload` - Works after plugin reload
- [ ] `test_e2e_config_change_reload` - Responds to config changes
- [ ] `test_e2e_upgrade_migration` - Data survives version upgrade

### Step 7.12: Regression Tests

#### Regression Tests
- [ ] `test_regression_lossless_equivalence` - Matches lossless-claw behavior
- [ ] `test_regression_backward_compat` - Works with old database
- [ ] `test_regression_api_stability` - API doesn't change
- [ ] `test_regression_config_schema` - Config schema stable

### Step 7.13: Security Tests

#### Security Tests
- [ ] `test_security_sql_injection` - SQL injection blocked
- [ ] `test_security_path_traversal` - Path traversal blocked
- [ ] `test_security_memory_isolation` - Sessions isolated
- [ ] `test_security_sensitive_data` - Sensitive data not logged

---

## Phase 8: Documentation & Release
**Duration:** Low  
**Priority:** Medium

### Step 8.1: Update README
- [ ] Installation instructions
- [ ] Configuration reference
- [ ] API documentation
- [ ] Migration guide from lossless-claw

### Step 8.2: Publish
- [ ] Publish to npm (quantum-memory)
- [ ] Or publish via openclaw plugins install (GitHub URL)

---

## Implementation Order

```
Phase 1 (Manifest) ─┬─> Phase 2 (Engine) ─┬─> Phase 3 (Tools)
                    │                      │
                    │                      ├─> Phase 4 (Missing)
                    │                      │
                    │                      ├─> Phase 5 (DB)
                    │                      │
                    │                      ├─> Phase 6 (Core)
                    │                      │
                    ├─> Phase 7 (Testing)
                    │
                    └─> Phase 8 (Release)
```

---

## Key Dependencies

1. **lossless-claw** - Reference implementation to model after
2. **openclaw/plugin-sdk** - For ContextEngine types
3. **better-sqlite3** - Already in use
4. **Node 22+** - Required

---

## Success Criteria

- [ ] Installs via `openclaw plugins install`
- [ ] Registers as context-engine
- [ ] Persists messages to SQLite
- [ ] Compacts via DAG summarization
- [ ] Provides agent tools for search/recall
- [ ] Entity extraction works
- [ ] Knowledge graph stores relations
- [ ] All 200+ tests pass

---

*Plan created: 2026-03-18*  
*Updated: 2026-03-18 - Added comprehensive testing phase*  
*Based on lossless-claw architecture analysis*
