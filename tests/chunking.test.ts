import { describe, it, expect } from 'vitest';
import { splitLargeRangeIntoWindows, STRUCTURE_MAX_SECTION_LINES, FALLBACK_CHUNK_LINES, FALLBACK_CHUNK_OVERLAP } from '../src/chunking';

describe('splitLargeRangeIntoWindows', () => {
  it('returns a single chunk when range is small', () => {
    const lines = new Array(10).fill('x');
    const chunks = splitLargeRangeIntoWindows(lines, 1, 10, 'Short Title', 'section');
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual({ startLine: 1, endLine: 10, kind: 'section', title: 'Short Title' });
  });

  it('splits a large range into overlapping windows with part titles and kind-part', () => {
    const total = 300;
    const lines = new Array(total).fill('x');
    const chunks = splitLargeRangeIntoWindows(lines, 1, total, 'Long Section', 'section');

    // With FALLBACK_CHUNK_LINES=80 and FALLBACK_CHUNK_OVERLAP=20 we expect 5 windows for 300 lines
    expect(chunks.length).toBe(5);

    // First window
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(FALLBACK_CHUNK_LINES);
    expect(chunks[0].title).toBe('Long Section (part 1)');
    expect(chunks[0].kind).toBe('section-part');

    // Second window should start at windowEnd - overlap + 1 => 80 - 20 + 1 = 61
    expect(chunks[1].startLine).toBe(FALLBACK_CHUNK_LINES - FALLBACK_CHUNK_OVERLAP + 1);

    // Last window should end at total
    expect(chunks[chunks.length - 1].endLine).toBe(total);
    expect(chunks[chunks.length - 1].title).toBe('Long Section (part 5)');
  });

  it('preserves kind "window" and uses default window titles when no inheritedTitle', () => {
    const total = 200;
    const lines = new Array(total).fill('x');
    const chunks = splitLargeRangeIntoWindows(lines, 1, total, undefined, 'window');

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks[i];
      expect(part.kind).toBe('window');
      expect(part.title).toBe(`window ${i + 1}`);
    }
  });

  it('small range with no inherited title/kind falls back to empty title and section kind', () => {
    const lines = new Array(STRUCTURE_MAX_SECTION_LINES).fill('x');
    const chunks = splitLargeRangeIntoWindows(lines, 1, STRUCTURE_MAX_SECTION_LINES);
    expect(chunks.length).toBe(1);
    expect(chunks[0].kind).toBe('section');
    expect(chunks[0].title).toBe('');
  });

  it('large range with no inherited title/kind yields section-part kinds and default window titles', () => {
    const total = 200;
    const lines = new Array(total).fill('x');
    const chunks = splitLargeRangeIntoWindows(lines, 1, total);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks[i];
      expect(part.kind).toBe('section-part');
      expect(part.title).toBe(`window ${i + 1}`);
    }
  });

  it('single-line range returns a single chunk', () => {
    const lines = ['only'];
    const chunks = splitLargeRangeIntoWindows(lines, 1, 1);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual({ startLine: 1, endLine: 1, kind: 'section', title: '' });
  });
});


