/**
 * Quantum Memory - Large File Handling
 * 
 * Handles large file content in messages by summarizing and storing references
 * instead of storing full content >25K tokens.
 * 
 * Improvements over lossless-claw:
 * - Token-based threshold (more accurate than character count)
 * - Summary caching to avoid re-summarizing
 * - Parallel processing for multiple files
 * - Hybrid LLM + deterministic fallback
 * 
 * @see https://github.com/qsmtco/quantum-memory
 */

import { estimateTokens } from './EntityExtractor.js';

// ============================================================================
// Constants
// ============================================================================

/** Default token threshold for large file detection */
export const DEFAULT_LARGE_FILE_THRESHOLD = 25_000;

/** Cache key prefix for summary cache */
export const SUMMARY_CACHE_PREFIX = 'qm_summary_';

/** Maximum parallel summaries to process */
export const DEFAULT_MAX_PARALLEL_SUMMARIES = 5;

// ============================================================================
// Regex Patterns
// ============================================================================

/** Regex to match <file name="..." mime="...">...</file> blocks */
const FILE_BLOCK_RE = /<file\b([^>]*)>([\s\S]*?)<\/file>/gi;

/** Regex to match file references like file_abc123def456 */
const FILE_ID_RE = /\bfile_[a-f0-9]{16}\b/gi;

// ============================================================================
// File Type Classifications
// ============================================================================

/** Code file extensions */
export const CODE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'go', 'h', 'hpp', 'java', 'js', 'jsx',
  'kt', 'm', 'php', 'py', 'rb', 'rs', 'scala', 'sh', 'sql', 'swift',
  'ts', 'tsx', 'vue', 'svelte', 'jsx', 'tsx'
]);

/** Structured data file extensions */
export const STRUCTURED_EXTENSIONS = new Set([
  'csv', 'json', 'tsv', 'xml', 'yaml', 'yml'
]);

/** MIME type prefixes for structured data */
export const STRUCTURED_MIME_PREFIXES = [
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/x-ndjson',
  'text/csv',
  'text/tab-separated-values',
  'text/xml',
];

/** MIME type prefixes for code */
export const CODE_MIME_PREFIXES = [
  'application/javascript',
  'application/typescript',
  'application/x-python-code',
  'application/x-rust',
  'text/javascript',
  'text/x-c',
  'text/x-c++',
  'text/x-go',
  'text/x-java',
  'text/x-python',
  'text/x-rust',
  'text/x-script.python',
  'text/x-shellscript',
  'text/x-typescript',
];

/** MIME type to extension mapping */
export const MIME_EXTENSION_MAP: Record<string, string> = {
  'application/json': 'json',
  'application/xml': 'xml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'application/x-ndjson': 'json',
  'application/csv': 'csv',
  'application/javascript': 'js',
  'application/typescript': 'ts',
  'application/x-python-code': 'py',
  'application/x-rust': 'rs',
  'application/x-sh': 'sh',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/tab-separated-values': 'tsv',
  'text/x-c': 'c',
  'text/x-c++': 'cpp',
  'text/x-go': 'go',
  'text/x-java': 'java',
  'text/x-python': 'py',
  'text/x-rust': 'rs',
  'text/x-script.python': 'py',
  'text/x-shellscript': 'sh',
  'text/x-typescript': 'ts',
};

// ============================================================================
// Types
// ============================================================================

/** File block extracted from message content */
export interface FileBlock {
  /** Full match string */
  fullMatch: string;
  /** Start position in original content */
  start: number;
  /** End position in original content */
  end: number;
  /** Parsed attributes */
  attributes: Record<string, string>;
  /** Filename from attributes */
  fileName?: string;
  /** MIME type from attributes */
  mimeType?: string;
  /** File content */
  text: string;
  /** Detected file extension */
  extension?: string;
  /** Token count of content */
  tokenCount?: number;
}

/** File reference for storage */
export interface FileReference {
  /** Unique file ID */
  fileId: string;
  /** Original filename */
  fileName?: string;
  /** MIME type */
  mimeType?: string;
  /** Original size in bytes */
  byteSize: number;
  /** Token count */
  tokenCount: number;
  /** Summary text */
  summary: string;
  /** Whether summary is from LLM */
  isLlmSummary: boolean;
}

/** Large file configuration */
export interface LargeFileConfig {
  /** Enable large file handling */
  enabled: boolean;
  /** Token threshold for summarization */
  threshold: number;
  /** Model for LLM summarization */
  summaryModel?: string;
  /** Provider for LLM summarization */
  summaryProvider?: string;
  /** Max parallel summaries */
  maxParallel: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate a unique file ID for a large file
 */
export function generateFileId(): string {
  const chars = 'abcdef0123456789';
  let id = 'file_';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Parse attributes from <file> tag
 */
function parseFileAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z_:][A-Za-z0-9_:\-.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    const key = (match[1] ?? '').trim().toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (key.length > 0 && value.length > 0) {
      attrs[key] = value;
    }
  }
  
  return attrs;
}

/**
 * Extract extension from filename
 */
function extractExtension(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  
  const base = fileName.trim().split(/[/\\]/).pop() ?? '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return undefined;
  
  const ext = base.slice(idx + 1).toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext)) return undefined;
  
  return ext;
}

/**
 * Guess extension from MIME type
 */
function guessExtension(mimeType?: string): string | undefined {
  if (!mimeType) return undefined;
  return MIME_EXTENSION_MAP[mimeType.trim().toLowerCase()];
}

/**
 * Detect file extension from name or MIME type
 */
export function detectFileExtension(fileName?: string, mimeType?: string): string | undefined {
  return extractExtension(fileName) ?? guessExtension(mimeType) ?? 'txt';
}

/**
 * Check if file is code (enhanced with MIME prefix matching)
 */
export function isCode(fileName?: string, mimeType?: string): boolean {
  const ext = detectFileExtension(fileName, mimeType);
  if (ext && CODE_EXTENSIONS.has(ext)) return true;
  
  // Check MIME prefix
  if (mimeType) {
    const mime = mimeType.trim().toLowerCase();
    if (CODE_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) return true;
  }
  
  return false;
}

/**
 * Check if file is structured data (enhanced with MIME prefix matching)
 */
export function isStructured(fileName?: string, mimeType?: string): boolean {
  const ext = detectFileExtension(fileName, mimeType);
  if (ext && STRUCTURED_EXTENSIONS.has(ext)) return true;
  
  // Check MIME prefix
  if (mimeType) {
    const mime = mimeType.trim().toLowerCase();
    if (STRUCTURED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) return true;
  }
  
  return false;
}

/**
 * Check if content exceeds token threshold (our improvement over lossless-claw)
 */
export function shouldSummarize(content: string, threshold: number = DEFAULT_LARGE_FILE_THRESHOLD): boolean {
  const tokens = estimateTokens(content);
  return tokens > threshold;
}

/**
 * Parse all <file> blocks from message content
 * 
 * @param content - Message content to parse
 * @returns Array of FileBlock objects
 */
export function parseFileBlocks(content: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  let match: RegExpExecArray | null;
  
  // Reset regex state
  FILE_BLOCK_RE.lastIndex = 0;
  
  while ((match = FILE_BLOCK_RE.exec(content)) !== null) {
    const fullMatch = match[0];
    const rawAttrs = match[1] ?? '';
    const text = match[2] ?? '';
    const start = match.index;
    const end = start + fullMatch.length;
    const attributes = parseFileAttributes(rawAttrs);
    const fileName = attributes.name;
    const mimeType = attributes.mime;
    const extension = detectFileExtension(fileName, mimeType);
    const tokenCount = estimateTokens(text);
    
    blocks.push({
      fullMatch,
      start,
      end,
      attributes,
      fileName,
      mimeType,
      text,
      extension,
      tokenCount,
    });
  }
  
  return blocks;
}

/**
 * Extract file IDs from content (for expansion detection)
 */
export function extractFileIds(content: string): string[] {
  const matches = content.match(FILE_ID_RE) ?? [];
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of matches) {
    const lower = id.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(lower);
    }
  }
  return result;
}

/**
 * Get default large file config
 */
export function getDefaultLargeFileConfig(): LargeFileConfig {
  return {
    enabled: true,
    threshold: DEFAULT_LARGE_FILE_THRESHOLD,
    maxParallel: DEFAULT_MAX_PARALLEL_SUMMARIES,
  };
}

// ============================================================================
// Summarization Strategies (Phase 2)
// ============================================================================

/**
 * Summarize JSON content - describe structure without full content
 */
export function summarizeJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    
    const describe = (value: unknown, depth = 0): string => {
      if (depth >= 2) return '...';
      if (Array.isArray(value)) {
        const sample = value.slice(0, 3).map(item => describe(item, depth + 1));
        return `array(len=${value.length}${sample.length > 0 ? `, sample=[${sample.join(', ')}]` : ''})`;
      }
      if (!value || typeof value !== 'object') return typeof value;
      
      const keys = Object.keys(value as Record<string, unknown>);
      const preview = keys.slice(0, 10).join(', ');
      return `object(keys=${keys.length}${preview ? `: ${preview}` : ''})`;
    };
    
    const topLevel = Array.isArray(parsed) ? 'array' : typeof parsed;
    return [
      'Structured summary (JSON):',
      `Top-level type: ${topLevel}.`,
      `Shape: ${describe(parsed)}.`,
    ].join('\n');
  } catch {
    return 'Structured summary (JSON): parse error - not valid JSON';
  }
}

/**
 * Summarize CSV/TSV content
 */
export function summarizeDelimited(content: string, delimiter: ',' | '\t' = ','): string {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length === 0) {
    return 'Structured summary (CSV): no rows found.';
  }
  
  const headers = (lines[0] ?? '').split(delimiter).map(h => h.trim()).filter(h => h.length > 0);
  const rowCount = Math.max(0, lines.length - 1);
  const firstData = lines[1] ? lines[1].substring(0, 180) : '(no data rows)';
  
  return [
    `Structured summary (CSV):`,
    `Rows: ${rowCount.toLocaleString('en-US')}.`,
    `Columns (${headers.length}): ${headers.join(', ') || '(none detected)'}.`,
    `First row sample: ${firstData}.`,
  ].join('\n');
}

/**
 * Summarize XML content
 */
export function summarizeXml(content: string): string {
  const rootMatch = content.match(/<([A-Za-z0-9_:-]+)(\s|>)/);
  const rootTag = rootMatch?.[1] ?? 'unknown';
  
  const allTags = [...content.matchAll(/<([A-Za-z0-9_:-]+)(\s|>)/g)]
    .map(m => m[1]!)
    .filter(tag => tag !== rootTag);
  
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const uniqueTags: string[] = [];
  for (const tag of allTags) {
    if (!seen.has(tag)) {
      seen.add(tag);
      uniqueTags.push(tag);
    }
  }
  
  return [
    'Structured summary (XML):',
    `Root element: ${rootTag}.`,
    `Child elements seen (${uniqueTags.length}): ${uniqueTags.slice(0, 30).join(', ') || '(none detected)'}.`,
  ].join('\n');
}

/**
 * Summarize YAML content
 */
export function summarizeYaml(content: string): string {
  const topLevelKeys = new Set<string>();
  
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(?:#.*)?$/);
    if (match) topLevelKeys.add(match[1]!);
  }
  
  const keysArray = Array.from(topLevelKeys).slice(0, 30);
  
  return [
    'Structured summary (YAML):',
    `Top-level keys (${topLevelKeys.size}): ${keysArray.join(', ') || '(none detected)'}.`,
  ].join('\n');
}

/**
 * Summarize code file - basic structure analysis
 */
export function summarizeCode(content: string, fileName?: string): string {
  const lines = content.split('\n');
  const lineCount = lines.length;
  
  // Count imports/requires
  const importMatches = content.match(/(?:import|require|from)\s+['"][^'"]+['"]/g) ?? [];
  const importCount = importMatches.length;
  
  // Detect language from extension
  const ext = detectFileExtension(fileName);
  const language = ext ? getLanguageName(ext) : 'unknown';
  
  // Basic function/class detection
  const functionMatches = content.match(/(?:function\s+|def\s+|fn\s+|func\s+|method\s+)([a-zA-Z_][a-zA-Z0-9_]*)/g) ?? [];
  const classMatches = content.match(/(?:class\s+|struct\s+|interface\s+)([A-Z][a-zA-Z0-9_]*)/g) ?? [];
  
  const functionCount = functionMatches.length;
  const classCount = classMatches.length;
  
  const parts = [
    `Code summary (${language}):`,
    `Lines: ${lineCount.toLocaleString()}.`,
  ];
  
  if (importCount > 0) parts.push(`Imports: ${importCount}.`);
  if (classCount > 0) parts.push(`Classes/structs: ${classCount}.`);
  if (functionCount > 0) parts.push(`Functions/methods: ${functionCount}.`);
  
  return parts.join('\n');
}

/**
 * Get language name from extension
 */
function getLanguageName(ext: string): string {
  const names: Record<string, string> = {
    js: 'JavaScript', ts: 'TypeScript', py: 'Python', java: 'Java',
    go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', cs: 'C#',
    cpp: 'C++', c: 'C', swift: 'Swift', kt: 'Kotlin', scala: 'Scala',
    sh: 'Shell', sql: 'SQL', json: 'JSON', xml: 'XML', yaml: 'YAML',
    html: 'HTML', css: 'CSS', md: 'Markdown',
  };
  return names[ext] ?? ext.toUpperCase();
}

/**
 * Summarize plain text - first/last lines + headers
 */
export function summarizeText(content: string): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  
  // Detect headers (markdown-style)
  const headers = lines.filter(line => /^#{1,6}\s+/.test(line)).slice(0, 10);
  
  // First and last few lines
  const firstLines = lines.slice(0, 5).join('\n');
  const lastLines = lines.slice(-3).join('\n');
  
  const parts = [
    'Text summary:',
    `Total lines: ${totalLines.toLocaleString()}.`,
  ];
  
  if (headers.length > 0) {
    parts.push(`Headers: ${headers.join(', ')}`);
  }
  
  parts.push('', 'First 5 lines:', firstLines);
  if (totalLines > 10) {
    parts.push('', 'Last 3 lines:', lastLines);
  }
  
  return parts.join('\n');
}

/**
 * Auto-detect and summarize based on file type
 */
export function summarizeContent(content: string, fileName?: string, mimeType?: string): string {
  const ext = detectFileExtension(fileName, mimeType);
  
  if (isStructured(fileName, mimeType)) {
    if (ext === 'json') return summarizeJson(content);
    if (ext === 'csv') return summarizeDelimited(content, ',');
    if (ext === 'tsv') return summarizeDelimited(content, '\t');
    if (ext === 'xml') return summarizeXml(content);
    if (ext === 'yaml' || ext === 'yml') return summarizeYaml(content);
  }
  
  if (isCode(fileName, mimeType)) {
    return summarizeCode(content, fileName);
  }
  
  return summarizeText(content);
}

// ============================================================================
// LLM Integration (Phase 3)
// ============================================================================

/** LLM summarizer function type */
export type TextSummarizer = (prompt: string) => Promise<string | null>;

/**
 * Build prompt for LLM summarization of large files
 */
export function buildLargeFilePrompt(params: {
  content: string;
  fileName?: string;
  mimeType?: string;
  maxTokens?: number;
}): string {
  const { content, fileName, mimeType, maxTokens = 2000 } = params;
  const ext = detectFileExtension(fileName, mimeType);
  
  return [
    `Summarize this ${ext} file for context compression.`,
    `Provide a concise summary that captures:`,
    `- Main purpose/functionality`,
    `- Key components or data structures`,
    `- Important patterns or conventions`,
    '',
    `Keep summary under ${maxTokens} tokens.`,
    '',
    '---FILE CONTENT---',
    content.substring(0, 50000), // Truncate to avoid huge prompts
    '---END---',
  ].join('\n');
}

/**
 * Summarize content using LLM with deterministic fallback
 * This is our hybrid approach - LLM first, fallback if it fails
 * 
 * @param content - File content to summarize
 * @param fileName - Optional filename
 * @param mimeType - Optional MIME type
 * @param summarizer - LLM summarizer function (if available)
 * @param maxTokens - Max tokens for summary
 * @returns Summarized content
 */
export async function summarizeWithLLM(
  content: string,
  fileName?: string,
  mimeType?: string,
  summarizer?: TextSummarizer,
  maxTokens: number = 2000
): Promise<string> {
  // Try LLM first if available
  if (summarizer) {
    try {
      const prompt = buildLargeFilePrompt({ content, fileName, mimeType, maxTokens });
      const result = await summarizer(prompt);
      
      if (result && result.trim().length > 0) {
        return result.trim();
      }
    } catch (error) {
      console.warn('[LargeFiles] LLM summarization failed, using deterministic:', error);
    }
  }
  
  // Fallback to deterministic summarization
  return summarizeContent(content, fileName, mimeType);
}

/**
 * Create a text summarizer from OpenClaw tools
 * Supports multiple LLM tool names
 */
export function createSummarizer(tools: Record<string, any>): TextSummarizer | undefined {
  // Find available LLM tool
  const toolNames = ['chat_completion', 'generate', 'llm', 'openai'];
  let llmTool: ((params: any) => Promise<any>) | null = null;
  
  for (const name of toolNames) {
    if (tools[name]) {
      llmTool = tools[name];
      break;
    }
  }
  
  if (!llmTool) {
    return undefined;
  }
  
  // Return summarizer function
  return async (prompt: string): Promise<string | null> => {
    try {
      const response = await llmTool({
        messages: [
          { role: 'system', content: 'You are a context compression assistant. Provide concise summaries.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
      });
      
      // Handle different response formats
      if (response?.content) return response.content;
      if (response?.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
      }
      if (typeof response === 'string') return response;
      
      return null;
    } catch (error) {
      console.warn('[LargeFiles] LLM call failed:', error);
      return null;
    }
  };
}

// ============================================================================
// Storage & References (Phase 4)
// ============================================================================

/**
 * Format a file reference for storage in messages
 * Similar to lossless-claw's formatFileReference
 */
export function formatFileReference(params: {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize: number;
  tokenCount: number;
  summary: string;
}): string {
  const name = params.fileName?.trim() || 'unknown';
  const mime = params.mimeType?.trim() || 'unknown';
  
  return [
    `[QM File: ${params.fileId} | ${name} | ${mime} | ${params.byteSize.toLocaleString()} bytes | ${params.tokenCount} tokens]`,
    '',
    'Summary:',
    params.summary.trim() || '(no summary available)',
  ].join('\n');
}

/**
 * Parse a file reference from message content
 */
export function parseFileReference(content: string): { fileId: string; fileName?: string; mimeType?: string } | null {
  const match = content.match(/\[QM File: (\S+) \| ([^|]+) \| ([^|]+) \|/);
  if (!match) return null;
  
  const fileId = match[1] ?? '';
  const fileName = match[2]?.trim() ?? '';
  const mimeType = match[3]?.trim() ?? '';
  
  return {
    fileId,
    fileName,
    mimeType,
  };
}

// ============================================================================
// Expansion (Phase 5)
// ============================================================================

/**
 * Large file storage interface
 * This would be implemented by the calling code to interact with database
 */
export interface LargeFileStore {
  getFile(fileId: string): Promise<LargeFileRecord | null>;
  saveFile(record: LargeFileRecord): Promise<void>;
}

/**
 * Record stored in large_files table
 */
export interface LargeFileRecord {
  id: string;
  sessionId: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize: number;
  tokenCount: number;
  summary: string;
  originalContent?: string; // Only populated if we store original
}

/**
 * Expansion result
 */
export interface FileExpansionResult {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize: number;
  summary: string;
  originalContent?: string;
  wasExpanded: boolean;
}

/**
 * Expand a file reference to get original content
 * 
 * @param fileId - The file ID to expand
 * @param store - Database store for large files
 * @returns Expansion result with original content if available
 */
export async function expandFile(
  fileId: string,
  store: LargeFileStore
): Promise<FileExpansionResult | null> {
  const record = await store.getFile(fileId);
  
  if (!record) {
    return null;
  }
  
  return {
    fileId: record.fileId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    summary: record.summary,
    originalContent: record.originalContent,
    wasExpanded: true,
  };
}

/**
 * Detect file references in content and prepare for expansion
 * 
 * @param content - Message content to scan
 * @returns Array of file IDs that can be expanded
 */
export function detectExpandableFiles(content: string): string[] {
  const fileIds = extractFileIds(content);
  
  // Filter to only QM file references
  return fileIds.filter(id => id.startsWith('file_'));
}

/**
 * Replace file references with expanded content in a message
 * 
 * @param content - Original message content
 * @param store - Large file store for expansion
 * @param expandAll - Whether to expand all references (default: false)
 * @returns Content with references optionally expanded
 */
export async function expandContent(
  content: string,
  store: LargeFileStore,
  expandAll: boolean = false
): Promise<string> {
  const fileIds = detectExpandableFiles(content);
  
  if (fileIds.length === 0) {
    return content;
  }
  
  // If not expanding all, just add expansion note
  if (!expandAll) {
    const note = `\n\n[${fileIds.length} large file(s) available. Use expand tool to view.]\n`;
    return content + note;
  }
  
  // Expand each file
  let result = content;
  for (const fileId of fileIds) {
    const expansion = await expandFile(fileId, store);
    if (expansion?.originalContent) {
      const placeholder = `[QM File: ${fileId} |`;
      const replacement = `[Original content for ${fileId}:\n${expansion.originalContent}\n--- End]\n[QM File: ${fileId} |`;
      result = result.replace(placeholder, replacement);
    }
  }
  
  return result;
}

// ============================================================================
// Caching & Optimization (Phase 6)
// ============================================================================

/**
 * Simple hash function for content (for cache key)
 */
export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Summary cache record
 */
export interface SummaryCacheRecord {
  contentHash: string;
  summary: string;
  tokenCount: number;
  createdAt: string;
}

/**
 * Summary cache store interface
 */
export interface SummaryCacheStore {
  get(hash: string): Promise<SummaryCacheRecord | null>;
  set(hash: string, summary: string, tokenCount: number): Promise<void>;
}

/**
 * Get cached summary if available
 */
export async function getCachedSummary(content: string, store: SummaryCacheStore): Promise<string | null> {
  const hash = hashContent(content);
  const cached = await store.get(hash);
  return cached?.summary ?? null;
}

/**
 * Cache a summary
 */
export async function cacheSummary(content: string, summary: string, tokenCount: number, store: SummaryCacheStore): Promise<void> {
  const hash = hashContent(content);
  await store.set(hash, summary, tokenCount);
}

/**
 * Summarize with caching - checks cache first, stores result
 */
export async function summarizeWithCache(
  content: string,
  fileName?: string,
  mimeType?: string,
  cacheStore?: SummaryCacheStore,
  summarizer?: TextSummarizer,
  maxTokens: number = 2000
): Promise<string> {
  // Check cache first
  if (cacheStore) {
    const cached = await getCachedSummary(content, cacheStore);
    if (cached) return cached;
  }

  // Generate summary
  const summary = await summarizeWithLLM(content, fileName, mimeType, summarizer, maxTokens);

  // Cache the result
  if (cacheStore) {
    const tokenCount = estimateTokens(content);
    await cacheSummary(content, summary, tokenCount, cacheStore);
  }

  return summary;
}

/**
 * Process multiple files in parallel
 */
export async function processFilesInParallel<T>(
  files: { fileId: string; content: string }[],
  processFn: (file: { fileId: string; content: string }) => Promise<T>,
  maxParallel: number = 5
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < files.length; i += maxParallel) {
    const batch = files.slice(i, i + maxParallel);
    const batchResults = await Promise.all(batch.map(processFn));
    results.push(...batchResults);
  }
  return results;
}
