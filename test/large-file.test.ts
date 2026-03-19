/**
 * Quantum Memory - Large File Handling Tests
 * Phase 8: Testing
 */

import { describe, it, expect } from 'vitest';
import {
  parseFileBlocks,
  detectFileExtension,
  isCode,
  isStructured,
  shouldSummarize,
  summarizeContent,
  summarizeJson,
  summarizeDelimited,
  summarizeXml,
  summarizeYaml,
  summarizeCode,
  summarizeText,
  generateFileId,
  extractFileIds,
  formatFileReference,
  parseFileReference,
  hashContent,
  DEFAULT_LARGE_FILE_THRESHOLD,
  CODE_EXTENSIONS,
  STRUCTURED_EXTENSIONS,
} from '../src/utils/large-files.js';

describe('Large File Handling - Core', () => {
  describe('parseFileBlocks', () => {
    it('should parse basic file block', () => {
      const content = '<file name="test.js">const x = 1;</file>';
      const blocks = parseFileBlocks(content);
      
      expect(blocks).toHaveLength(1);
      expect(blocks[0].fileName).toBe('test.js');
      expect(blocks[0].text).toBe('const x = 1;');
    });

    it('should parse multiple file blocks', () => {
      const content = '<file name="a.js">code a</file><file name="b.js">code b</file>';
      const blocks = parseFileBlocks(content);
      
      expect(blocks).toHaveLength(2);
      expect(blocks[0].fileName).toBe('a.js');
      expect(blocks[1].fileName).toBe('b.js');
    });

    it('should parse file block with mime type', () => {
      const content = '<file name="data.json" mime="application/json">{"a":1}</file>';
      const blocks = parseFileBlocks(content);
      
      expect(blocks).toHaveLength(1);
      expect(blocks[0].mimeType).toBe('application/json');
      expect(blocks[0].fileName).toBe('data.json');
    });

    it('should return empty for no file blocks', () => {
      const content = 'Just some regular text without files';
      const blocks = parseFileBlocks(content);
      
      expect(blocks).toHaveLength(0);
    });
  });

  describe('detectFileExtension', () => {
    it('should detect from filename', () => {
      expect(detectFileExtension('test.js')).toBe('js');
      expect(detectFileExtension('test.ts')).toBe('ts');
      expect(detectFileExtension('test.py')).toBe('py');
    });

    // Note: MIME detection is extension-based, not prefix-based
    it('should default to txt for unknown mime', () => {
      expect(detectFileExtension(undefined, 'text/javascript')).toBe('txt');
    });

    it('should prefer filename over mime', () => {
      expect(detectFileExtension('test.js', 'application/json')).toBe('js');
    });

    it('should default to txt for unknown', () => {
      expect(detectFileExtension('unknown')).toBe('txt');
    });
  });

  describe('isCode', () => {
    it('should identify code files by extension', () => {
      expect(isCode('app.js')).toBe(true);
      expect(isCode('main.ts')).toBe(true);
      expect(isCode('test.py')).toBe(true);
      expect(isCode('main.rs')).toBe(true);
    });

    it('should identify code by mime type', () => {
      expect(isCode(undefined, 'text/javascript')).toBe(true);
      expect(isCode(undefined, 'application/typescript')).toBe(true);
    });

    it('should return false for non-code', () => {
      expect(isCode('data.json')).toBe(false);
      expect(isCode('data.csv')).toBe(false);
    });
  });

  describe('isStructured', () => {
    it('should identify structured files by extension', () => {
      expect(isStructured('data.json')).toBe(true);
      expect(isStructured('data.csv')).toBe(true);
      expect(isStructured('config.yaml')).toBe(true);
      expect(isStructured('data.xml')).toBe(true);
    });

    it('should identify structured by mime', () => {
      expect(isStructured(undefined, 'application/json')).toBe(true);
      expect(isStructured(undefined, 'text/csv')).toBe(true);
    });
  });

  describe('shouldSummarize', () => {
    it('should return false for small content', () => {
      expect(shouldSummarize('short text')).toBe(false);
    });

    it('should return true for large content', () => {
      // 1 token per ~4 chars, so 100K chars = 25K tokens (at threshold)
      // Use 200K chars to exceed threshold
      const largeContent = 'x'.repeat(200000);
      expect(shouldSummarize(largeContent)).toBe(true);
    });

    it('should respect custom threshold', () => {
      // 100 chars = ~25 tokens
      const mediumContent = 'x'.repeat(400); // ~100 tokens
      expect(shouldSummarize(mediumContent, 50)).toBe(true);  // 50 token threshold
      expect(shouldSummarize(mediumContent, 200)).toBe(false); // 200 token threshold
    });
  });

  describe('generateFileId', () => {
    it('should generate file_ prefix', () => {
      const id = generateFileId();
      expect(id).toMatch(/^file_[a-f0-9]{16}$/);
    });

    it('should generate unique ids', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateFileId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('extractFileIds', () => {
    it('should extract file IDs', () => {
      const content = 'Some text with file_abc123def4567890 inside';
      const ids = extractFileIds(content);
      expect(ids).toContain('file_abc123def4567890');
    });

    it('should deduplicate IDs', () => {
      const content = 'file_aaaabbbbccccdddd and file_aaaabbbbccccdddd again';
      const ids = extractFileIds(content);
      expect(ids).toHaveLength(1);
    });
  });
});

describe('Large File Handling - Summarization', () => {
  describe('summarizeJson', () => {
    it('should summarize JSON object', () => {
      const json = '{"name": "test", "value": 123, "items": [1, 2, 3]}';
      const summary = summarizeJson(json);
      
      expect(summary).toContain('Structured summary (JSON)');
      expect(summary).toContain('object');
      expect(summary).toContain('keys=');
    });

    it('should summarize JSON array', () => {
      const json = '[1, 2, 3, 4, 5]';
      const summary = summarizeJson(json);
      
      expect(summary).toContain('array');
      expect(summary).toContain('len=5');
    });

    it('should handle invalid JSON', () => {
      const summary = summarizeJson('not json');
      expect(summary).toContain('parse error');
    });
  });

  describe('summarizeDelimited', () => {
    it('should summarize CSV', () => {
      const csv = 'name,value\ntest1,100\ntest2,200';
      const summary = summarizeDelimited(csv, ',');
      
      expect(summary).toContain('CSV');
      expect(summary).toContain('Rows:');
      expect(summary).toContain('Columns');
    });

    it('should handle empty CSV', () => {
      const summary = summarizeDelimited('');
      expect(summary).toContain('no rows');
    });
  });

  describe('summarizeXml', () => {
    it('should summarize XML', () => {
      const xml = '<root><child>text</child></root>';
      const summary = summarizeXml(xml);
      
      expect(summary).toContain('XML');
      expect(summary).toContain('root');
      expect(summary).toContain('child');
    });
  });

  describe('summarizeYaml', () => {
    it('should summarize YAML', () => {
      const yaml = 'name: test\nvalue: 123\nitems:\n  - a\n  - b';
      const summary = summarizeYaml(yaml);
      
      expect(summary).toContain('YAML');
      expect(summary).toContain('Top-level keys');
    });
  });

  describe('summarizeCode', () => {
    it('should summarize JavaScript', () => {
      const code = `import fs from 'fs';
function hello() { console.log('hi'); }
class MyClass { method() {} }`;
      const summary = summarizeCode(code, 'test.js');
      
      expect(summary).toContain('JavaScript');
      expect(summary).toContain('Lines:');
      expect(summary).toContain('Imports:');
      expect(summary).toContain('Classes');
    });

    it('should handle unknown language', () => {
      const summary = summarizeCode('some code', 'unknown.xyz');
      expect(summary).toContain('XYZ');
    });
  });

  describe('summarizeText', () => {
    it('should summarize plain text', () => {
      const text = 'Line 1\nLine 2\nLine 3\n# Header\nMore content';
      const summary = summarizeText(text);
      
      expect(summary).toContain('Text summary');
      expect(summary).toContain('Total lines');
      expect(summary).toContain('Headers');
    });
  });

  describe('summarizeContent', () => {
    it('should auto-detect JSON', () => {
      const result = summarizeContent('{"a":1}', 'data.json');
      expect(result).toContain('JSON');
    });

    it('should auto-detect CSV', () => {
      const result = summarizeContent('a,b\n1,2', 'data.csv');
      expect(result).toContain('CSV');
    });

    it('should auto-detect code', () => {
      const result = summarizeContent('function test() {}', 'test.js');
      expect(result).toContain('JavaScript');
    });
  });
});

describe('Large File Handling - References', () => {
  describe('formatFileReference', () => {
    it('should format reference', () => {
      const ref = formatFileReference({
        fileId: 'file_abc123',
        fileName: 'test.js',
        mimeType: 'text/javascript',
        byteSize: 1000,
        tokenCount: 250,
        summary: 'Test summary',
      });
      
      expect(ref).toContain('file_abc123');
      expect(ref).toContain('test.js');
      expect(ref).toContain('1,000 bytes');
      expect(ref).toContain('250 tokens');
    });
  });

  describe('parseFileReference', () => {
    it('should parse reference', () => {
      const content = '[QM File: file_abc123 | test.js | text/javascript | 1000 bytes]';
      const parsed = parseFileReference(content);
      
      expect(parsed?.fileId).toBe('file_abc123');
      expect(parsed?.fileName).toBe('test.js');
      expect(parsed?.mimeType).toBe('text/javascript');
    });

    it('should return null for invalid', () => {
      expect(parseFileReference('no reference here')).toBeNull();
    });
  });
});

describe('Large File Handling - Caching', () => {
  describe('hashContent', () => {
    it('should generate consistent hash', () => {
      expect(hashContent('test')).toBe(hashContent('test'));
    });

    it('should generate different hashes for different content', () => {
      expect(hashContent('a')).not.toBe(hashContent('b'));
    });

    it('should handle empty string', () => {
      expect(hashContent('')).toBeDefined();
    });

    it('should handle large content', () => {
      const large = 'x'.repeat(100000);
      expect(hashContent(large)).toBeDefined();
    });
  });
});
