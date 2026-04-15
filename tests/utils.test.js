import { describe, it, expect } from 'vitest';
import { hasText, truncate, normalizeWhitespace, safeSlug, splitCamelCase, normalizeTerm, isUsefulTerm, tokenizeText, countTerms, topTermsFromCounts, buildPreviewFromLines, extractQuotedStrings, bucketForTerm, } from '../src/utils';
describe('utils', () => {
    it('hasText and truncate work', () => {
        expect(hasText('  hi ')).toBe(true);
        expect(hasText('')).toBe(false);
        expect(truncate('hello', 3)).toBe('...');
    });
    it('normalizeWhitespace works', () => {
        expect(normalizeWhitespace('  a\n  b   c  ')).toBe('a b c');
    });
    it('safeSlug works', () => {
        expect(safeSlug('Find THIS! Query')).toBe('find-this-query');
        expect(safeSlug('', 'fallback')).toBe('fallback');
    });
    it('splitCamelCase works', () => {
        expect(splitCamelCase('SalesOrderView')).toEqual(['Sales', 'Order', 'View']);
        expect(splitCamelCase('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    });
    it('normalizeTerm and isUsefulTerm', () => {
        expect(normalizeTerm('  Foo-Bar ')).toBe('foo-bar');
        expect(isUsefulTerm('a')).toBe(false);
        expect(isUsefulTerm('foo')).toBe(true);
        expect(isUsefulTerm('123')).toBe(false);
    });
    it('tokenizeText and counts', () => {
        const tokens = tokenizeText('SalesOrderView get_sales-order rate');
        expect(tokens).toContain('sales');
        expect(tokens).toContain('order');
        expect(tokens).toContain('view');
        const counts = countTerms(tokens);
        expect(counts.get('sales')).toBeGreaterThanOrEqual(1);
        const top = topTermsFromCounts(counts, 2);
        expect(top.length).toBeLessThanOrEqual(2);
    });
    it('buildPreviewFromLines and extractQuotedStrings', () => {
        const lines = ['   ', 'Title', '', 'First line', 'Second line'];
        expect(buildPreviewFromLines(lines)).toBe('Title | First line | Second line');
        expect(extractQuotedStrings("He said 'hello' and \"goodbye\".")).toEqual(['hello', 'goodbye']);
    });
    it('bucketForTerm', () => {
        expect(bucketForTerm('apple')).toBe('a');
        expect(bucketForTerm('123foo')).toBe('num');
        expect(bucketForTerm('_private')).toBe('other');
    });
});
