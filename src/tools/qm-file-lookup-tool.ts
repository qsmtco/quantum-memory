/**
 * Quantum Memory - File Lookup Tool
 * 
 * Looks up a stored large file by its file ID.
 * Used to expand [QM File: ...|STUB] references in trimmed messages.
 */

import { Type } from "@sinclair/typebox";

/**
 * File lookup tool input schema
 */
export const QmFileLookupSchema = Type.Object({
  fileId: Type.String({
    description: "The file ID from a [QM File: ...|STUB] reference",
  }),
  includeContent: Type.Optional(
    Type.Boolean({
      description: "If true, returns the full original file content (default: false, returns summary only)",
    })
  ),
});

/**
 * Tool result for file lookup
 */
export interface QmFileLookupResult {
  found: boolean;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize: number;
  tokenCount: number;
  summary: string;
  originalContent?: string;
}

/**
 * Create file lookup tool for Quantum Memory
 * 
 * @param deps - Dependencies including getFile function
 */
export function createQmFileLookupTool(deps: {
  getFile: (fileId: string) => Promise<{
    fileId: string;
    fileName?: string;
    mimeType?: string;
    byteSize: number;
    tokenCount: number;
    summary: string;
    originalContent?: string;
  } | null>;
}) {
  return {
    name: 'qm_file_lookup',
    description: `Look up a large file stored by Quantum Memory.

Use this when you see [QM File: FILE_ID|...|STUB] in a message and need the actual file content.

Parameters:
- fileId: The file ID from the STUB reference
- includeContent: Set to true to get the full original file content (default: false, returns summary only)`,
    inputSchema: QmFileLookupSchema,

    async execute(input: {
      fileId: string;
      includeContent?: boolean;
    }): Promise<QmFileLookupResult> {
      const { fileId, includeContent = false } = input;

      if (!fileId || typeof fileId !== 'string') {
        return {
          found: false,
          fileId: String(fileId ?? ''),
          byteSize: 0,
          tokenCount: 0,
          summary: 'Error: fileId is required and must be a string',
        };
      }

      const result = await deps.getFile(fileId);

      if (!result) {
        return {
          found: false,
          fileId,
          byteSize: 0,
          tokenCount: 0,
          summary: `File '${fileId}' not found in Quantum Memory. It may have been garbage collected.`,
        };
      }

      return {
        found: true,
        fileId: result.fileId,
        fileName: result.fileName,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        tokenCount: result.tokenCount,
        summary: result.summary,
        originalContent: includeContent ? (result.originalContent ?? result.summary) : undefined,
      };
    },
  };
}
