import { describe, it, expect } from 'vitest';
import {
  hasText,
  truncate,
  normalizeWhitespace,
  safeSlug,
  splitCamelCase,
  normalizeTerm,
  isUsefulTerm,
  tokenizeText,
  toPosixPath,
  countTerms,
  topTermsFromCounts,
  buildPreviewFromLines,
  extractQuotedStrings,
  bucketForTerm,
  toRelativeProjectPath,
} from '../src/utils';
import path from 'path';

describe('utils', () => {
  it('hasText and truncate work', () => {
    expect(hasText('  hi ')).toBe(true);
    expect(hasText('')).toBe(false);
    expect(truncate('hello', 3)).toBe('...');
    // truncate should return empty string for empty/whitespace-only input
    expect(truncate('', 10)).toBe('');
    expect(truncate('   ', 10)).toBe('');
  });

  it('toPosixPath converts backslashes to forward slashes', () => {
    expect(toPosixPath('a\\b\\c')).toBe('a/b/c');
    expect(toPosixPath('already/posix')).toBe('already/posix');
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
    // ensure stopword branch is covered for a term with length >= 2
    expect(isUsefulTerm('an')).toBe(false);
    expect(isUsefulTerm('foo')).toBe(true);
    expect(isUsefulTerm('123')).toBe(false);
    // numbers of length >= 4 are allowed
    expect(isUsefulTerm('2023')).toBe(true);
  });

  it('tokenizeText and counts', () => {
    const tokens = tokenizeText('SalesOrderView get_sales-order rate XMLHTTP 2023 a b 1234');
    // camel case split
    expect(tokens).toContain('sales');
    expect(tokens).toContain('order');
    expect(tokens).toContain('view');
    // separator parts
    expect(tokens).toContain('get');
    // the original token is also preserved (normalized without separators)
    expect(tokens).toContain('salesorderview');
    // numeric handling: 'a' and 'b' are filtered as too short
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('b');

    const counts = countTerms(tokens);
    expect(counts.get('sales')).toBeGreaterThanOrEqual(1);

    // top terms ordering: create a small map and assert ordering by count then lexicographic
    const sampleCounts = new Map([
      ['apple', 2],
      ['banana', 2],
      ['cherry', 1],
    ]);

    const top = topTermsFromCounts(sampleCounts, 3);
    // apple and banana have same count; lexicographic order should place 'apple' before 'banana'
    expect(top[0].term).toBe('apple');
    expect(top[1].term).toBe('banana');
    expect(top[2].term).toBe('cherry');
  });

  it('buildPreviewFromLines and extractQuotedStrings', () => {
    const lines = ['   ', 'Title', '', 'First line', 'Second line'];
    expect(buildPreviewFromLines(lines)).toBe('Title | First line | Second line');
    expect(extractQuotedStrings("He said 'hello' and \"goodbye\".")).toEqual(['hello', 'goodbye']);
    // limit parameter
    expect(extractQuotedStrings("\"one\" \"two\" \"three\"", 2)).toEqual(['one', 'two']);
    // backtick quotes and length limits
    const long = '`' + 'x'.repeat(200) + '`';
    // matches because length within 120? actually 200 > 120 so should not match
    expect(extractQuotedStrings(long)).toEqual([]);
    // 'ok' is only two characters long and the extractor requires 3-120 chars
    expect(extractQuotedStrings("`short` `ok` `also`", 2)).toEqual(['short', 'also']);
  });

  it('bucketForTerm', () => {
    expect(bucketForTerm('apple')).toBe('a');
    expect(bucketForTerm('123foo')).toBe('num');
    expect(bucketForTerm('_private')).toBe('other');
  });

  it('toRelativeProjectPath produces posix-style relative paths', () => {
    const absolute = path.join('C:', 'proj', 'sub', 'file.txt');
    const root = path.join('C:', 'proj');
    const rel = toRelativeProjectPath(absolute, root);
    // should be normalized to posix separators
    expect(rel).toBe('sub/file.txt');
  });
});

