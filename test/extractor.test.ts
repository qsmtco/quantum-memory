import { describe, it, expect } from 'vitest';
import { extractEntities } from '../src/utils/EntityExtractor.js';

describe('EntityExtractor', () => {
  it('should extract tools from text', () => {
    const result = extractEntities('Using Python and TypeScript for the backend');
    
    const tools = result.entities.filter(e => e.type === 'tool');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some(t => t.name.toLowerCase() === 'python')).toBe(true);
    expect(tools.some(t => t.name.toLowerCase() === 'typescript')).toBe(true);
  });

  it('should extract persons from capitalized words', () => {
    const result = extractEntities('John and Alice are working on this');
    
    const persons = result.entities.filter(e => e.type === 'person');
    expect(persons.some(p => p.name === 'John')).toBe(true);
    expect(persons.some(p => p.name === 'Alice')).toBe(true);
  });

  it('should extract email addresses as persons', () => {
    const result = extractEntities('Contact bob@example.com for details');
    
    const persons = result.entities.filter(e => e.type === 'person');
    expect(persons.some(p => p.name === 'bob')).toBe(true);
  });

  it('should extract relations between entities', () => {
    const result = extractEntities('John works on Quantum using Python');
    
    expect(result.relations.length).toBeGreaterThan(0);
    expect(result.relations.some(r => r.type === 'works_on')).toBe(true);
  });

  it('should assign confidence scores', () => {
    const result = extractEntities('John uses Python for the backend');
    
    const python = result.entities.find(e => e.name.toLowerCase() === 'python');
    expect(python?.confidence).toBe(0.9);
  });

  it('should handle empty text', () => {
    const result = extractEntities('');
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('should handle short text', () => {
    const result = extractEntities('Hi');
    expect(result.entities).toHaveLength(0);
  });

  it('should deduplicate entities', () => {
    const result = extractEntities('Python is used in Python development');
    
    const python = result.entities.filter(e => e.name.toLowerCase() === 'python');
    expect(python.length).toBe(1);
  });
});
