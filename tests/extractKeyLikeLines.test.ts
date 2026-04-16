import { describe, it, expect } from 'vitest';
import { truncate } from '../src/utils';
import { extractKeyLikeLines } from '../src/extractKeyLikeLines';

describe('extractKeyLikeLines', () => {
    it('extracts colon-labeled lines and trims whitespace', () => {
        const lines = ['   ', '  Title: some value  ', '\t'];
        const result = extractKeyLikeLines(lines);
        expect(result).toStrictEqual(['Title: some value']);
    });

    it('extracts equals-assignment lines', () => {
        const lines = ['NAME = value', 'other'];
        const result = extractKeyLikeLines(lines);
        expect(result).toStrictEqual(['NAME = value']);
    });

    it('skips non-matching lines', () => {
        const lines = ['this is text', 'function call()', 'no-colon-or-equals'];
        expect(extractKeyLikeLines(lines)).toStrictEqual([]);
    });

    it('respects the limit and preserves ordering (default limit 8)', () => {
        const lines: string[] = [];
        for(let i = 0; i < 12; i++) {
            lines.push(`Key${i}: value`);
        }
        const result = extractKeyLikeLines(lines);
        expect(result.length).toBe(8);
        expect(result[0]).toBe('Key0: value');
        expect(result[7]).toBe('Key7: value');
    });

    it('respects custom limit and stops after reaching it', () => {
        // labels must be 2-60 chars according to the original regex
        const lines = ['AA: 1', 'BB: 2', 'CC: 3'];
        const result = extractKeyLikeLines(lines, 2);
        expect(result).toStrictEqual(['AA: 1', 'BB: 2']);
    });

    it('when limit is 0 behaves like original (pushes first match then breaks)', () => {
        // Original implementation checks results.length >= limit after pushing,
        // so when limit === 0 the first match will still be pushed then it will break.
        const lines = ['First: x', 'Second: y'];
        const result = extractKeyLikeLines(lines, 0);
        expect(result).toStrictEqual(['First: x']);
    });

    it('truncates lines longer than 160 characters using truncate semantics', () => {
        const longValue = 'x'.repeat(200);
        const line = `Label: ${longValue}`;
        const [out] = extractKeyLikeLines([line]);
        // Should be truncated to at most 160 chars and end with '...'
        expect(out.length).toBeLessThanOrEqual(160);
        expect(out.endsWith('...')).toBe(true);
        // Also ensure it begins with the label prefix
        expect(out.startsWith('Label: ')).toBe(true);
        // For exactness we can compare with truncate(trimmed, 160)
        const expected = truncate(line.trim(), 160);
        expect(out).toBe(expected);
    });

    it('does not match non-ascii labels for the colon-regex (preserves original behavior)', () => {
        // The original colon regex only permits ASCII A-Za-z0-9 and a few symbols.
        const lines = ['名: 値', 'Normal: ok'];
        const result = extractKeyLikeLines(lines);
        // Only the ASCII label should match
        expect(result).toStrictEqual(['Normal: ok']);
    });
});



