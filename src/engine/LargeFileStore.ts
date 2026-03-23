import { randomUUID } from 'crypto';
import { extractFileIds, summarizeWithLLM } from '../utils/large-files.js';
import type { TextSummarizer } from '../utils/large-files.js';
import { estimateTokens } from '../trim/types.js';

export interface LargeFileRecord {
  id: string;
  sessionId: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize: number;
  tokenCount: number;
  summary: string;
  originalContent?: string;
}

/**
 * LargeFileStore - manages large file metadata and summaries.
 * Implements the LargeFileStore interface from large-files.ts.
 */
export class LargeFileStore {
  constructor(
    private db: any,
    private summarizer?: TextSummarizer
  ) {}

  /**
   * Get a file by its ID
   */
  async getFile(fileId: string): Promise<LargeFileRecord | null> {
    const row = this.db.query(
      `SELECT * FROM large_files WHERE file_id = ? LIMIT 1`,
      [fileId]
    );
    if (!row || row.length === 0) return null;
    return this.mapRow(row[0]);
  }

  /**
   * Save a file record to the database
   */
  async saveFile(record: Omit<LargeFileRecord, 'id'>): Promise<LargeFileRecord> {
    const id = `lfile_${randomUUID().slice(0, 12)}`;
    this.db.run(
      `INSERT OR REPLACE INTO large_files (id, session_id, file_id, file_name, mime_type, byte_size, token_count, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.sessionId,
        record.fileId,
        record.fileName ?? null,
        record.mimeType ?? null,
        record.byteSize,
        record.tokenCount,
        record.summary,
      ]
    );
    return { id, ...record };
  }

  /**
   * Process a message and detect/save any file references found in its content.
   * If a summarizer is provided, generates a summary via LLM for each detected file.
   * Called during ingestBatch to ensure file references are tracked and summarized.
   */
  async processMessage(
    sessionId: string,
    content: string,
    summarizer?: TextSummarizer
  ): Promise<void> {
    const fileIds = extractFileIds(content);
    if (fileIds.length === 0) return;

    // For each file reference, check if we already have it and save if new
    for (const fileId of fileIds) {
      const existing = this.db.query(
        `SELECT id FROM large_files WHERE file_id = ? AND session_id = ? LIMIT 1`,
        [fileId, sessionId]
      );
      if (existing && existing.length > 0) continue; // Already tracked

      // Parse metadata from the file reference string if available
      const meta = this.parseFileMeta(content, fileId);

      // Generate summary via LLM if summarizer provided, else placeholder
      let summary = '[File detected — summary pending expansion]';
      let tokenCount = 0;
      if (summarizer) {
        try {
          // Try to get original content from the message
          const fileContent = this.extractFileContent(content, fileId);
          if (fileContent) {
            const result = await summarizeWithLLM(fileContent, meta.fileName, meta.mimeType, summarizer);
            summary = result;
            tokenCount = estimateTokens(fileContent);
          }
        } catch (err) {
          console.warn(`[LargeFileStore] LLM summarization failed for ${fileId}:`, err);
        }
      }

      this.db.run(
        `INSERT OR IGNORE INTO large_files (id, session_id, file_id, file_name, mime_type, byte_size, token_count, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `lfile_${randomUUID().slice(0, 12)}`,
          sessionId,
          fileId,
          meta.fileName ?? null,
          meta.mimeType ?? null,
          meta.byteSize ?? 0,
          tokenCount,
          summary,
        ]
      );
    }
  }

  /**
   * Extract original file content from a message that contains [QM File: ...] references.
   * Returns the content between the file reference and the next delimiter.
   */
  private extractFileContent(content: string, fileId: string): string | null {
    // Match [QM File: {fileId} | ... | ... | ...]\n{content}\n[END]
    const pattern = new RegExp(`\\[QM File: ${fileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|[^|]+\\|[^|]+\\|([^|]+)\\|?\\]?\\n([\\s\\S]*?)(?:\\n\\[END\\]|$)`);
    const match = content.match(pattern);
    return match ? (match[2] ?? null) : null;
  }

  /**
   * Parse file metadata from content string containing [QM File: ...] references
   */
  private parseFileMeta(content: string, fileId: string): { fileName?: string; mimeType?: string; byteSize?: number } {
    // Match [QM File: {fileId} | {filename} | {mimeType} | {size} |]
    const pattern = new RegExp(`\\[QM File: ${fileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|?\\]?`);
    const match = content.match(pattern);
    if (!match) return {};

    const [, fileName, mimeType, sizeStr] = match;
    return {
      fileName: fileName?.trim(),
      mimeType: mimeType?.trim(),
      byteSize: parseInt(sizeStr?.trim() ?? '0', 10) || 0,
    };
  }

  private mapRow(row: any): LargeFileRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      fileId: row.file_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: row.byte_size ?? 0,
      tokenCount: row.token_count ?? 0,
      summary: row.summary ?? '',
      originalContent: row.original_content,
    };
  }
}
