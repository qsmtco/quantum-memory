import { randomUUID } from 'crypto';

/**
 * Entity types supported by Quantum Memory
 */
export type EntityType = 'person' | 'project' | 'tool' | 'concept';

/**
 * Extracted entity with name and type
 */
export interface ExtractedEntity {
  name: string;
  type: EntityType;
  confidence: number;
}

/**
 * EntityExtractionResult - contains extracted entities and relations
 */
export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  relations: Array<{
    from: string;
    to: string;
    type: string;
    sourceText: string;
  }>;
}

/**
 * Known tool names for pattern matching - joined into regex pattern
 */
const KNOWN_TOOLS_PATTERN = /\b(python|typescript|javascript|node|nodejs|docker|git|sql|postgresql|mysql|sqlite|mongodb|redis|elasticsearch|react|vue|angular|nextjs|express|fastify|graphql|rest|http|websocket|grpc|json|yaml|toml|bash|shell|zsh|fish|powershell|cmd|vim|vscode|intellij|webstorm|pycharm|sublime|aws|gcp|azure|cloudflare|vercel|netlify|kubernetes|helm|terraform|ansible|puppet|nginx|apache|caddy|haproxy|jest|vitest|mocha|pytest|unittest|rspec|minitest|eslint|prettier|webpack|vite|rollup|esbuild|openclaw|claude|gpt|llm|ai)\b/gi;

/**
 * Known project indicators
 */
const PROJECT_PATTERNS = [
  /\b(Project|App|System|Platform|Service|API|SDK|Library|Tool|Framework)\b/gi,
  /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, // CamelCase names
];

/**
 * Known relation patterns
 */
const RELATION_PATTERNS = [
  { pattern: /(\w+)\s+(?:works on|working on|building|developing)\s+(\w+)/gi, relation: 'works_on' },
  { pattern: /(\w+)\s+(?:uses|using|utilizes)\s+(\w+)/gi, relation: 'uses' },
  { pattern: /(\w+)\s+(?:knows|knows about|met)\s+(\w+)/gi, relation: 'knows' },
  { pattern: /(\w+)\s+(?:depends on|depends upon)\s+(\w+)/gi, relation: 'depends_on' },
  { pattern: /(\w+)\s+(?:created|made|built)\s+(\w+)/gi, relation: 'created' },
  { pattern: /(\w+)\s+(?:integrated|integrates|connected)\s+(\w+)/gi, relation: 'integrates_with' },
];

/**
 * ExtractEntities - extracts entities from text using pattern matching
 * 
 * This is a lightweight extraction method. For production, could be replaced
 * with LLM-based extraction by calling the LLM tool.
 * 
 * @param text - Input text to extract entities from
 * @returns EntityExtractionResult with entities and relations
 * 
 * @example
 * const result = extractEntities("John is working on Quantum project using Python");
 * // result.entities: [{name: 'John', type: 'person', confidence: 0.8}, ...]
 */
export function extractEntities(text: string): EntityExtractionResult {
  const entities: ExtractedEntity[] = [];
  const relations: Array<{ from: string; to: string; type: string; sourceText: string }> = [];
  
  // Deduplication set - key is lowercase name
  const seen = new Map<string, ExtractedEntity>();
  const addEntity = (name: string, type: EntityType, confidence: number) => {
    const lowerName = name.toLowerCase();
    
    // Skip if we already have this entity with equal or higher confidence
    const existing = seen.get(lowerName);
    if (existing && existing.confidence >= confidence) {
      // If types differ, prefer tool > project > person
      const typePriority = { tool: 3, project: 2, concept: 1, person: 0 };
      if ((typePriority[existing.type] || 0) >= (typePriority[type] || 0)) {
        return;
      }
    }
    seen.set(lowerName, { name, type, confidence });
  };
  
  // 1. Extract tools/technologies (known patterns)
  const toolMatches = Array.from(text.matchAll(KNOWN_TOOLS_PATTERN));
  for (const match of toolMatches) {
    const toolName = match[1];
    if (!toolName) continue;
    addEntity(toolName.toLowerCase(), 'tool', 0.9);
  }
  
  // 2. Extract potential projects (CamelCase and pattern matches)
  for (const pattern of PROJECT_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const name = match[1] || match[0];
      if (name.length > 2 && !KNOWN_TOOLS_PATTERN.test(name)) {
        addEntity(name, 'project', 0.5);
      }
    }
  }
  
  // 3. Extract capitalized words as potential persons
  // Be conservative: require at least 2 chars, skip common words
  const commonWords = new Set(['I', 'We', 'The', 'A', 'An', 'This', 'That', 'It', 'He', 'She', 'They', 'You', 'My', 'Your', 'Our']);
  const capitalized = text.match(/[A-Z][a-z]{2,}/g) || [];
  // Check if word is a known tool by testing case-insensitively
  const isKnownTool = (word: string) => /\b(python|typescript|javascript|node|nodejs|docker|git|sql|postgresql|mysql|sqlite|mongodb|redis|elasticsearch|react|vue|angular|nextjs|express|fastify|graphql|rest|http|websocket|grpc|json|yaml|toml|bash|shell|zsh|fish|powershell|cmd|vim|vscode|intellij|webstorm|pycharm|sublime|aws|gcp|azure|cloudflare|vercel|netlify|kubernetes|helm|terraform|ansible|puppet|nginx|apache|caddy|haproxy|jest|vitest|mocha|pytest|unittest|rspec|minitest|eslint|prettier|webpack|vite|rollup|esbuild|openclaw|claude|gpt|llm|ai)\b/i.test(word);
  for (const word of capitalized) {
    if (!commonWords.has(word) && !isKnownTool(word)) {
      addEntity(word, 'person', 0.3); // Lower confidence - needs verification
    }
  }
  
  // 4. Extract email addresses as persons
  const emails = text.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
  for (const email of emails) {
    const name = email.split('@')[0] ?? '';
    addEntity(name, 'person', 0.8);
  }
  
  // 5. Extract relations between entities
  for (const { pattern, relation } of RELATION_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const [, from, to] = match;
      if (!from || !to) continue;
      // Check if from/to are in our entities
      const fromKey = from.toLowerCase();
      const toKey = to.toLowerCase();
      
      // Only add relation if we have some entity reference
      if (fromKey && toKey && fromKey !== toKey) {
        relations.push({
          from: from,
          to: to,
          type: relation,
          sourceText: match[0] ?? '',
        });
      }
    }
  }
  
  // Convert seen map to array
  const uniqueEntities = Array.from(seen.values());
  
  return { entities: uniqueEntities, relations };
}

/**
 * Estimate token count (rough: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
