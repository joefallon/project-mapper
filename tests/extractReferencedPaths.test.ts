import { describe, it, expect } from 'vitest';
import { extractReferencedPaths } from '../src/extractReferencedPaths';

describe('extractReferencedPaths', () => {
    it('returns empty array for null/undefined/empty input', () => {
        expect(extractReferencedPaths(undefined)).toEqual([]);
        expect(extractReferencedPaths(null)).toEqual([]);
        expect(extractReferencedPaths('')).toEqual([]);
    });

    it('extracts simple filenames and preserves order', () => {
        const text = 'See README.md and src/index.ts for details.';
        expect(extractReferencedPaths(text)).toEqual(['README.md', 'src/index.ts']);
    });

    it('normalizes leading ./ prefix', () => {
        const text = './lib/util.js and ./lib/util.js again';
        expect(extractReferencedPaths(text)).toEqual(['lib/util.js']);
    });

    it('does not remove ../ prefix and still uses basename for filtering', () => {
        const text = '../other/thing.txt and ./thing.txt and thing.txt';
        const known = new Set(['thing.txt']);
        // ../other/thing.txt basename is thing.txt and should be accepted
        expect(extractReferencedPaths(text, known)).toEqual(['../other/thing.txt', 'thing.txt']);
    });

    it('deduplicates preserving first occurrence', () => {
        const text = 'a/b/c.txt a/b/c.txt ./a/b/c.txt c.txt';
        // First seen normalized is 'a/b/c.txt', './a/b/c.txt' normalizes to 'a/b/c.txt'
        expect(extractReferencedPaths(text)).toEqual(['a/b/c.txt', 'c.txt']);
    });

    it('filters by knownBasenamesSet', () => {
        const text = 'foo.js bar.py baz.rb';
        const known = new Set(['bar.py', 'nope.txt']);
        expect(extractReferencedPaths(text, known)).toEqual(['bar.py']);
    });

    it('respects the 12-item limit', () => {
        const many = Array.from({length: 20}, (_, i) => `file${i}.js`).join(' ');
        const result = extractReferencedPaths(many);
        expect(result.length).toBe(12);
        // first three should match expectations
        expect(result[0]).toBe('file0.js');
        expect(result[11]).toBe('file11.js');
    });

    it('matches multi-dot filenames and unusual extensions', () => {
        const text = 'archive.tar.gz config.env.local VERSION.1';
        expect(extractReferencedPaths(text)).toEqual(['archive.tar.gz', 'config.env.local', 'VERSION.1']);
    });
});

