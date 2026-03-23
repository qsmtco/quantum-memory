# Quantum Memory V2 — Release Concerns

**Document created:** 2026-03-22
**Author:** QTR (Cutter) — Kage-7 Assassin Android, Qontinuum Bridge

This document lists known concerns that must be addressed before calling this production-ready for public end users. Not blocking for v1.0 beta / developers.

---

## ✅ Confirmed Working (High Confidence)

These have been verified end-to-end with integration tests:

- ✅ Token budget always enforced — `assemble()` never exceeds `tokenBudget`
- ✅ Compaction converges — 3-level fallback chain (LLM → Keyword → Deterministic) guarantees reduction
- ✅ SQL injection fully blocked — all inputs escaped, parameterized queries everywhere
- ✅ Input validation at all public APIs — `validateSessionId`, `validateEntityName`, `validateEntityType`, `validateMessageContent`
- ✅ `dispose()` resets all 11 lazy stores correctly
- ✅ Large file stubs preserve file IDs — `[QM File: ...|STUB]` can be looked up with `qm_file_lookup`
- ✅ DAG structure correct — summaries stored with proper levels and parent links
- ✅ FTS5 full-text search works with fallback to LIKE
- ✅ 232 tests passing, including full-cycle integration tests

---

## ⚠️ Concerns for End-User Release

### 1. LLM Summarization Quality (High Priority)

**Problem:** We've tested the LLM path with mocks and verified it runs end-to-end, but we haven't verified that the summaries it produces are *accurate* representations of the conversation.

**Risk:** A hallucinated or misleading summary gets stored in the DAG and fed back to the model in future context. The model then makes decisions based on lies it generated itself.

**What we verified:** The LLM is called, returns structured output, stores correctly, retrieves correctly, assembles into context correctly.

**What we haven't verified:** Whether the content of those summaries faithfully represents what was actually said.

**What a human needs to do:** Read 10-20 real LLM summaries generated from actual conversations and judge whether they're accurate. This is a human judgment call, not an automated test.

**Recommendation:** Label the release as v1.0 beta with a note that LLM summary quality depends on the underlying model, and users should audit summaries periodically.

---

### 2. Real OpenClaw Integration (Medium Priority)

**Problem:** The plugin has never been tested against a live OpenClaw instance running an actual agent loop.

**Risk:** There may be environmental differences between our test harness and a real OpenClaw setup:
- Token budget accounting (does OpenClaw double-count our assembled context?)
- Session lifecycle (when does `dispose()` get called in real usage?)
- Plugin API differences between versions
- The `openclawConfig` passed to the engine constructor — is it populated in real deployments?

**What we verified:** The plugin registers correctly, stores are created, operations complete.

**What we haven't verified:** Real agent loop running for hours/days, handling real user messages, triggering real compaction cycles.

**Recommendation:** Test on a real OpenClaw instance with a long-running conversation before public v1.0 release.

---

### 3. Auto-Recall Token Accounting (Medium Priority)

**Problem:** `AutoRecallInjector` injects up to 1000 tokens of recalled memories into `assemble()`. OpenClaw also has its own token budget management.

**Risk:** Double-counting — OpenClaw might count the injected memories toward its own limits while we also count them, leading to unexpected truncation or context overflow.

**What we verified:** `assemble()` returns the correct structure with recalled memories prepended.

**What we haven't verified:** How OpenClaw's own token accounting interacts with our assembled context.

**Recommendation:** Add instrumentation to measure actual token counts at OpenClaw boundaries and verify there's no double-counting.

---

### 4. Summary Store `model_used` Migration

**Problem:** We added `model_used` to the summaries table schema with a runtime migration (ALTER TABLE). For fresh installs this is fine. For existing databases with old schemas, the migration runs on first access.

**Risk:** The migration could fail silently on some SQLite versions or configurations, causing `model_used` to remain null even for new summaries.

**What we verified:** The migration runs in test environments.

**Recommendation:** Verify the migration succeeds in the target deployment environment. Consider adding a version check or logging to confirm the column exists after migration.

---

### 5. LLM Non-JSON Fallback Behavior

**Problem:** When LLM returns non-JSON output, the engine gracefully uses the raw content as a summary (instead of falling back to keyword extraction).

**Risk:** If the LLM produces verbose but useless text, it gets stored as a summary anyway. This could result in low-quality summaries being used in context.

**Current behavior is intentional** (graceful degradation), but it means "LLM succeeded" doesn't always mean "LLM produced good output."

**Recommendation:** Document this behavior. Consider adding a minimum quality threshold (e.g., summary must be > 20 chars and contain at least one keyword).

---

## Summary for Release Decision

| Concern | Blocking for Beta? | Blocking for Stable? |
|---------|-------------------|---------------------|
| LLM Quality | No | No (audit required) |
| Real OpenClaw Integration | No | Yes |
| Auto-Recall Accounting | No | Yes |
| `model_used` Migration | No | No |
| Non-JSON Fallback | No | No |

**Current status:** v1.0 beta ready for developers.

**For v1.0 stable:** Address items 1, 2, and 3.

---

## Testing Log

| Date | Test | Result |
|------|------|--------|
| 2026-03-22 | Full cycle (100 msgs → compact → assemble) | ✅ Pass |
| 2026-03-22 | LLM summarization path (mock) | ✅ Pass |
| 2026-03-22 | LLM non-JSON fallback | ✅ Pass |
| 2026-03-22 | dispose() resets all stores | ✅ Pass |
| 2026-03-22 | Large file stub lookup | ✅ Pass |
| 2026-03-22 | SQL injection protection | ✅ Pass |
| 2026-03-22 | Token budget enforcement | ✅ Pass |
| 2026-03-22 | FTS5 search | ✅ Pass |
| 2026-03-22 | Input validation | ✅ Pass |
| 2026-03-22 | Real OpenClaw instance | ❌ Not Tested |
| 2026-03-22 | Human audit of LLM summaries | ❌ Not Done |
| 2026-03-22 | Auto-recall token accounting | ❌ Not Verified |

---

*Document will be updated as concerns are resolved.*
