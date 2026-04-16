import { describe, it, expect } from 'vitest';
import { detectBoundaries } from '../src/boundary';

describe('detectBoundaries', () => {
  it('detects markdown ATX headings', () => {
    const lines = ['# Heading'];
    const boundaries = detectBoundaries(lines);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].startLine).toBe(1);
    expect(boundaries[0].kind).toBe('heading');
    expect(boundaries[0].title).toBe('Heading');
  });

  it('detects html headings', () => {
    const lines = ['   <h2>Title</h2>'];
    const boundaries = detectBoundaries(lines);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].kind).toBe('heading');
    expect(boundaries[0].title).toBe('Title');
  });

  it('detects underlined headings', () => {
    const lines = ['Section Title', '-------', 'more'];
    const boundaries = detectBoundaries(lines);
    // boundary at index 0 (startLine 1)
    expect(boundaries[0].startLine).toBe(1);
    expect(boundaries[0].kind).toBe('heading');
    expect(boundaries[0].title).toBe('Section Title');
  });

  it('detects ini sections', () => {
    const lines = ['[my-section]'];
    const boundaries = detectBoundaries(lines);
    expect(boundaries[0].kind).toBe('section');
    expect(boundaries[0].title).toBe('my-section');
  });

  it('detects delimiter and uses previous line as title when present', () => {
    const lines = ['Delim Title', '----------', 'x'];
    const boundaries = detectBoundaries(lines);
    // delimiter boundary is at index 1 -> startLine 2
    const delim = boundaries.find((b) => b.kind === 'delimiter');
    expect(delim).toBeDefined();
    expect(delim!.startLine).toBe(2);
    expect(delim!.title).toBe('Delim Title');
  });

  it('does not treat an isolated fence line as a structural boundary (matches original heuristics)', () => {
    const lines = ['```js'];
    const boundaries = detectBoundaries(lines);
    // per original heuristics, an isolated fence line isn't registered as a boundary
    expect(boundaries[0].kind).toBe('window');
  });

  it('detects declaration-like lines', () => {
    const lines = ['export async function doThing() {'];
    const boundaries = detectBoundaries(lines);
    const decl = boundaries.find((b) => b.kind === 'declaration');
    expect(decl).toBeDefined();
    expect(decl!.title).toContain('export async function doThing');
  });

  it('falls back to window when no boundaries found', () => {
    expect(detectBoundaries([])).toHaveLength(1);
    const single = detectBoundaries(['just a line']);
    expect(single).toHaveLength(1);
    expect(single[0].kind).toBe('window');
    expect(single[0].startLine).toBe(1);
  });

  it('returns boundaries in file order for multiple markers', () => {
    const lines = ['# A', 'x', '## B'];
    const boundaries = detectBoundaries(lines);
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
    expect(boundaries[0].title).toBe('A');
    expect(boundaries[1].title).toBe('B');
    expect(boundaries[0].startLine).toBe(1);
    expect(boundaries[1].startLine).toBe(3);
  });
});


