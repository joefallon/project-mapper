import { describe, it, expect } from 'vitest';
import { extractIdentifiers } from '../src/text/identifiers';

describe('text.identifiers', () => {
    it('returns empty for empty input', () => {
        expect(extractIdentifiers('')).toEqual([]);
    });

    it('counts identifiers and orders by count then lexicographic', () => {
        const result = extractIdentifiers('alpha beta alpha gamma');
        expect(result[0]).toEqual({identifier: 'alpha', count: 2});
        // beta and gamma have same count; beta < gamma lexicographically
        expect(result[1]).toEqual({identifier: 'beta', count: 1});
        expect(result[2]).toEqual({identifier: 'gamma', count: 1});
    });

    it('filters common lowercase stopwords', () => {
        const result = extractIdentifiers('the and foo the bar');
        // 'the' and 'and' should be filtered when all-lower, leaving foo and bar
        const ids = result.map((r) => r.identifier);
        expect(ids).toContain('foo');
        expect(ids).toContain('bar');
        expect(ids).not.toContain('the');
        expect(ids).not.toContain('and');
    });

    it('respects tokens with punctuation and underscores', () => {
        const result = extractIdentifiers('get_user-id get_user-id other');
        expect(result[0]).toEqual({identifier: 'get_user-id', count: 2});
    });

    it('applies the limit parameter', () => {
        const result = extractIdentifiers('aLongIdentifier one two three four five six seven eight nine ten eleven twelve thirteen', 5);
        expect(result.length).toBeLessThanOrEqual(5);
    });
});

