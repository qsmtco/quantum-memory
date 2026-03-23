/**
 * Quantum Memory - Full Cycle Integration Test
 * 
 * Tests the complete lifecycle: ingest → compact → assemble
 * Injects 100 messages, triggers compaction, verifies assembled context is correct.
 * 
 * @see CHECKPOINT_CODING_PROMPT.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuantumContextEngine, registerQuantumMemory } from '../src/engine/QuantumEngine.js';
import { closeDatabase } from '../src/db/Database.js';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = '~/.openclaw/quantum-cycle-test.db';

describe('Full Cycle: Ingest 100 → Compact → Assemble', () => {
  let engine: QuantumContextEngine;
  let sessionId: string;

  const makeSessionId = () => `cycle-${randomUUID().slice(0, 8)}`;

  beforeEach(() => {
    closeDatabase();
    const path = TEST_DB.replace('~', process.env.HOME || '/root');
    if (existsSync(path)) {
      try { unlinkSync(path); } catch {}
    }

    const mockApi = {
      registerContextEngine: (_id: string, _factory: () => any) => {},
      tools: undefined,
    } as any;

    engine = registerQuantumMemory(mockApi);
    sessionId = makeSessionId();
  });

  afterEach(() => {
    const path = TEST_DB.replace('~', process.env.HOME || '/root');
    if (existsSync(path)) {
      try { unlinkSync(path); } catch {}
    }
    closeDatabase();
  });

  it('ingests 100 messages and assembles correct context after compaction', async () => {
    // Step 1: Bootstrap session
    await engine.bootstrap({
      sessionId,
      sessionKey: sessionId,
      sessionFile: '/tmp/test-cycle',
    });

    // Step 2: Ingest 100 messages
    // Simulate varied conversation: first 68 messages get "older", last 32 are "recent"
    const MESSAGE_COUNT = 100;
    const FRESH_TAIL = 32;
    const msgs: Array<{ role: string; content: string }> = [];

    for (let i = 1; i <= MESSAGE_COUNT; i++) {
      const isRecent = i > MESSAGE_COUNT - FRESH_TAIL;
      const topic = i % 3 === 0 ? 'quantum' : i % 3 === 1 ? 'python' : 'project';
      const importance = isRecent ? 0.7 + (i % 10) * 0.03 : 0.1 + (i % 5) * 0.05;
      const content = `Message ${i} about ${topic} with some meaningful content here`;
      msgs.push({ role: 'user', content });
    }

    // Ingest all messages
    for (const msg of msgs) {
      await engine.ingest({ sessionId, message: msg as any });
    }

    // Step 3: Verify messages are stored
    const ctxStore = (engine as any).getContextStore();
    const msgStore = (engine as any).getMessageStore();
    const totalTokens = ctxStore.getTokenCount(sessionId);
    expect(totalTokens).toBeGreaterThan(0);
    const allMsgs = msgStore.getBySession(sessionId);
    expect(allMsgs.length).toBe(MESSAGE_COUNT);

    // Step 4: Verify we are over compaction threshold
    // 100 messages × ~8 tokens avg = ~800 tokens. With freshTailCount=32, the
    // 68 older messages should push us over threshold (threshold = 75% of 32K = 24K).
    // We also need enough tokens to trigger compaction — use a lower budget.
    const needsCompaction = ctxStore.needsCompaction(sessionId, 0.01); // 1% of 32K = 320 tokens
    expect(needsCompaction).toBe(true);

    // Step 5: Trigger compaction with a tight budget
    const compactResult = await engine.compact({
      sessionId,
      sessionKey: sessionId,
      sessionFile: '/tmp/test-cycle',
      tokenBudget: 500, // Force compaction: keep context to 500 tokens
      force: true,
    });

    // Compaction should have run at some level (deterministic as fallback)
    expect(compactResult.ok).toBe(true);
    expect(compactResult.compacted).toBe(true);
    expect(compactResult.messagesCompacted).toBeGreaterThan(0);

    // Step 6: Verify summaries were created in the DAG
    const summaryStore = (engine as any).getSummaryStore();
    const summaries = summaryStore.getBySession(sessionId);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].level).toBe(1); // First summary should be at level 1

    // Step 7: Verify compacted messages are marked
    const uncompacted = msgStore.getBySession(sessionId, { includeCompacted: false });
    const allMsgs2 = msgStore.getBySession(sessionId, { includeCompacted: true });
    expect(allMsgs2.length).toBe(MESSAGE_COUNT); // All 100 messages still exist in DB
    expect(uncompacted.length).toBeLessThan(MESSAGE_COUNT); // Some are compacted
    expect(uncompacted.length).toBe(32); // Fresh tail of 32 remains uncompacted

    // Step 8: Assemble context — the critical verification
    // Use a tight budget to force summary inclusion
    const budget = 500;
    const assembled = await engine.assemble({
      sessionId,
      messages: [{ role: 'user', content: 'Continue working' } as any],
      tokenBudget: budget,
    });

    // Step 9: Verify assembled context structure
    const assembledMsgs = assembled.messages;
    expect(assembledMsgs.length).toBeGreaterThan(0);

    // Step 10: Verify token budget is respected
    const assembledTokens = assembledMsgs.reduce(
      (sum: number, m: any) => sum + (m.tokens || 0),
      0
    );
    expect(assembledTokens).toBeLessThanOrEqual(budget);

    // Step 11: Verify summaries are present (older compacted context)
    // Summaries have role='system' and content starts with '[Earlier Context]'
    const summaryItems = assembledMsgs.filter((m: any) =>
      m.role === 'system' && String(m.content).startsWith('[Earlier Context]')
    );
    expect(summaryItems.length).toBeGreaterThan(0);

    // Step 12: Verify fresh tail is present (most recent messages)
    // Fresh messages have role='user' and content starts with 'Message'
    const messageItems = assembledMsgs.filter((m: any) =>
      m.role === 'user' && String(m.content).startsWith('Message')
    );
    expect(messageItems.length).toBeGreaterThan(0);

    // Step 13: Verify summaries come before fresh tail (chronological order)
    const firstSummaryIdx = assembledMsgs.findIndex((m: any) =>
      m.role === 'system' && String(m.content).startsWith('[Earlier Context]')
    );
    const lastMsgIdx = assembledMsgs.length - 1 - [...assembledMsgs].reverse().findIndex((m: any) =>
      m.role === 'user' && String(m.content).startsWith('Message')
    );
    expect(firstSummaryIdx).toBeLessThan(lastMsgIdx);

    // Step 14: Verify token accounting is correct
    const dagDepth = ctxStore.getDagDepth(sessionId);
    expect(dagDepth).toBeGreaterThan(0); // Compaction created at least one summary level

    // Token budget verified via assembled.estimatedTokens
    expect(assembled.estimatedTokens).toBeLessThanOrEqual(budget);

    // Step 15: Verify summary content makes sense (keyword summary of the 68 compacted messages)
    const summaryContent = summaryItems[0]?.content || '';
    expect(summaryContent.length).toBeGreaterThan(10); // Not empty
    expect(summaryContent).toContain('Keyword Summary'); // Keyword summary label
    // Should contain keywords from the compacted messages
    expect(summaryContent.toLowerCase()).toMatch(/message|quantum|python|project/);

    // Step 16: Verify summary precedes fresh tail (oldest context first)
    const freshTailContent = messageItems[0]?.content || '';
    expect(freshTailContent).toContain('Message'); // Most recent messages

    console.log(`  Full cycle: 100 msgs → 1 keyword summary → ${assembled.estimatedTokens} tokens (budget: ${budget})`);
  });
});
