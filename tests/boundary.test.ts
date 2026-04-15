import { describe, it, expect } from 'vitest';
import { inferBoundaryKind } from '../src/boundary';

describe('inferBoundaryKind', () => {
  it('identifies markdown headings as heading', () => {
    const lines = ['# Heading'];
    expect(inferBoundaryKind(lines, 0)).toBe('heading');
  });

  it('identifies html headings as heading', () => {
    const lines = ['   <h2>Title</h2>'];
    expect(inferBoundaryKind(lines, 0)).toBe('heading');
  });

  it('identifies ini section lines as section', () => {
    const lines = ['[my-section]'];
    expect(inferBoundaryKind(lines, 0)).toBe('section');
  });

  it('identifies delimiter lines as delimiter', () => {
    const lines = ['----'];
    expect(inferBoundaryKind(lines, 0)).toBe('delimiter');
  });

  it('identifies fence start as fence', () => {
    const lines = ['```js'];
    expect(inferBoundaryKind(lines, 0)).toBe('fence');
  });

  it('identifies declaration-like lines as declaration', () => {
    const lines = ['export async function doThing() {'];
    expect(inferBoundaryKind(lines, 0)).toBe('declaration');

    const lines2 = ['class Foo extends Bar {'];
    expect(inferBoundaryKind(lines2, 0)).toBe('declaration');
  });

  it('falls back to section for unknown or out-of-range indices', () => {
    const lines: string[] = ['Some random line'];
    expect(inferBoundaryKind(lines, 0)).toBe('section');
    expect(inferBoundaryKind([], 10)).toBe('section');
  });
});

