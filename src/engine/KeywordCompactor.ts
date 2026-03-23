/**
 * Quantum Memory - Keyword Compactor
 * 
 * Fallback compaction strategy that extracts entities, decisions, and topics
 * without requiring LLM access. Used when LLM is unavailable or fails.
 * 
 * Based on LCM (Lossless Context Management) research:
 * - Paper: https://github.com/martian-engineering/lossless-claw
 * - "If a summarization level fails, escalate to more aggressive strategy"
 * 
 * @see docs/IMPLEMENTATION_PLAN.md Phase 2.2
 */

import type { Message } from './MessageStore.js';
import type { SummaryStore } from '../dag/SummaryStore.js';
import type { CompactionLevel } from '../types/context-engine.js';
import { estimateTokens } from '../trim/types.js';

/**
 * Result of keyword-based compaction
 */
export interface KeywordCompactResult {
  ok: boolean;
  compacted: boolean;
  summaryId?: string;
  messagesCompacted: number;
  tokenReduction: number;
  level: CompactionLevel;
  summary: string;
}

/**
 * KeywordCompactor - deterministic compaction without LLM
 * 
 * Extracts:
 * - Named entities (persons, projects, tools, concepts)
 * - Decisions (patterns like "decided", "chose", "will use")
 * - Top topics (most frequent significant words)
 */
export class KeywordCompactor {
  constructor(
    private msgStore: { getByIds: (ids: string[]) => Message[]; markCompacted: (ids: string[]) => void },
    private summaryStore: { create: (sessionId: string, level: number, content: string, options?: any) => any; getMaxLevel: (sessionId: string) => number },
  ) {}

  /**
   * Compact messages using keyword extraction (no LLM needed)
   * 
   * @param sessionId - Session to compact
   * @param messageIds - IDs of messages to compact
   * @returns Compaction result with summary
   */
  compact(sessionId: string, messageIds: string[]): KeywordCompactResult {
    if (messageIds.length === 0) {
      return {
        ok: true,
        compacted: false,
        messagesCompacted: 0,
        tokenReduction: 0,
        level: 'keyword',
        summary: '',
      };
    }

    const messages = this.msgStore.getByIds(messageIds);
    
    // Extract entities using regex patterns
    const entities = this.extractEntities(messages);
    
    // Extract decisions using pattern matching
    const decisions = this.extractDecisions(messages);
    
    // Extract top topics by word frequency
    const topics = this.extractTopics(messages);
    
    // Build summary
    const summary = this.buildSummary({
      messageCount: messages.length,
      entities,
      decisions,
      topics,
    });
    
    // Calculate token reduction
    const tokensBefore = messages.reduce((sum, m) => sum + (m.tokens || estimateTokens(m.content)), 0);
    const tokensAfter = estimateTokens(summary);
    
    // Create summary in DAG
    const currentLevel = this.summaryStore.getMaxLevel(sessionId) + 1;
    const summaryNode = this.summaryStore.create(sessionId, currentLevel, summary, {
      sourceMessageIds: messageIds,
    });
    
    // Mark messages as compacted
    this.msgStore.markCompacted(messageIds);
    
    return {
      ok: true,
      compacted: true,
      summaryId: summaryNode?.id,
      messagesCompacted: messageIds.length,
      tokenReduction: tokensBefore - tokensAfter,
      level: 'keyword',
      summary,
    };
  }

  /**
   * Extract named entities from messages
   * Uses regex patterns for persons, projects, tools, concepts
   */
  private extractEntities(messages: Message[]): {
    persons: string[];
    projects: string[];
    tools: string[];
    concepts: string[];
  } {
    const persons = new Set<string>();
    const projects = new Set<string>();
    const tools = new Set<string>();
    const concepts = new Set<string>();

    // Entity patterns
    const personPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const projectPattern = /\b([A-Z][a-z]+[A-Z][a-z]+)\b|\b([A-Z]{2,}[a-z]*)\b/g;  // CamelCase or acronyms
    const toolPattern = /\b(python|typescript|javascript|node|npm|docker|git|github|postgres|sqlite|redis|express|react|vue|angular)\b/gi;
    const conceptPattern = /\b([a-z]+(?:ing|tion|ment|ness|ity|ism|ist))\b/gi;

    for (const msg of messages) {
      const content = msg.content;
      
      // Extract persons (capitalized names)
      let match;
      while ((match = personPattern.exec(content)) !== null) {
        const name = match[1];
        if (name && name.length > 2 && !this.isCommonWord(name)) {
          persons.add(name);
        }
      }
      
      // Extract projects (CamelCase or acronyms)
      while ((match = projectPattern.exec(content)) !== null) {
        const project = match[1] || match[2];
        if (project && project.length > 2) {
          projects.add(project);
        }
      }
      
      // Extract tools
      while ((match = toolPattern.exec(content)) !== null) {
        if (match[0]) {
          tools.add(match[0].toLowerCase());
        }
      }
      
      // Extract concepts (words ending in -ing, -tion, etc.)
      while ((match = conceptPattern.exec(content)) !== null) {
        const concept = match[1];
        if (concept && concept.length > 4 && !this.isCommonWord(concept)) {
          concepts.add(concept.toLowerCase());
        }
      }
    }

    return {
      persons: Array.from(persons).slice(0, 10),
      projects: Array.from(projects).slice(0, 10),
      tools: Array.from(tools).slice(0, 10),
      concepts: Array.from(concepts).slice(0, 10),
    };
  }

  /**
   * Extract decisions from messages
   * Looks for patterns like "decided", "chose", "will use"
   */
  private extractDecisions(messages: Message[]): string[] {
    const decisions: string[] = [];
    
    const decisionPatterns = [
      /(?:decided|chose|selected|picked|will use|going with|agreed on|concluded)\s+(?:to\s+)?([^.!?]+)[.!?]/gi,
      /(?:the\s+)?(?:plan|approach|solution|decision)\s+(?:is|was)\s+([^.!?]+)[.!?]/gi,
    ];

    for (const msg of messages) {
      for (const pattern of decisionPatterns) {
        let match;
        while ((match = pattern.exec(msg.content)) !== null) {
          const decision = match[1]?.trim();
          if (decision && decision.length > 5 && decision.length < 200) {
            decisions.push(decision);
          }
        }
      }
    }

    return decisions.slice(0, 5);
  }

  /**
   * Extract top topics by word frequency
   */
  private extractTopics(messages: Message[]): string[] {
    const wordFreq = new Map<string, number>();
    
    // Common words to ignore
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
      'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
      'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'whose',
      'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
      'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
      'here', 'there', 'then', 'once', 'if', 'else', 'but', 'and', 'or',
      'for', 'with', 'about', 'against', 'between', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down',
      'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
      'get', 'got', 'getting', 'make', 'made', 'making', 'go', 'going',
      'went', 'come', 'came', 'coming', 'take', 'took', 'taking', 'see',
      'saw', 'seeing', 'know', 'knew', 'knowing', 'think', 'thought',
    ]);

    for (const msg of messages) {
      const words = msg.content
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      }
    }

    return Array.from(wordFreq.entries())
      .filter(([_, count]) => count >= 2)  // Must appear at least twice
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Check if word is too common to be useful as entity
   */
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'The', 'This', 'That', 'These', 'Those', 'What', 'Which', 'Who',
      'When', 'Where', 'Why', 'How', 'All', 'Each', 'Every', 'Both',
      'Some', 'Any', 'No', 'Not', 'Only', 'Same', 'Just', 'Also',
      'Then', 'Now', 'Here', 'There', 'Today', 'Tomorrow', 'Yesterday',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December',
      'Please', 'Thanks', 'Thank', 'Yes', 'No', 'Okay', 'Ok', 'Sure',
      'Hello', 'Hi', 'Hey', 'Good', 'Bad', 'New', 'Old', 'First', 'Last',
    ]);
    return commonWords.has(word);
  }

  /**
   * Build summary from extracted data
   */
  private buildSummary(data: {
    messageCount: number;
    entities: { persons: string[]; projects: string[]; tools: string[]; concepts: string[] };
    decisions: string[];
    topics: string[];
  }): string {
    const parts: string[] = [];
    
    parts.push(`[Keyword Summary of ${data.messageCount} messages]`);
    
    if (data.entities.persons.length > 0) {
      parts.push(`\nPersons: ${data.entities.persons.join(', ')}`);
    }
    
    if (data.entities.projects.length > 0) {
      parts.push(`Projects: ${data.entities.projects.join(', ')}`);
    }
    
    if (data.entities.tools.length > 0) {
      parts.push(`Tools: ${data.entities.tools.join(', ')}`);
    }
    
    if (data.entities.concepts.length > 0) {
      parts.push(`Concepts: ${data.entities.concepts.join(', ')}`);
    }
    
    if (data.decisions.length > 0) {
      parts.push(`\nDecisions:`);
      for (const decision of data.decisions) {
        parts.push(`  - ${decision}`);
      }
    }
    
    if (data.topics.length > 0) {
      parts.push(`\nKey Topics: ${data.topics.join(', ')}`);
    }
    
    return parts.join('\n');
  }
}
