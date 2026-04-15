import { describe, it, expect } from 'vitest';
import prettyJson from '../src/prettyJson';

describe('prettyJson', () => {
  it('stringifies objects with 2-space indentation', () => {
    const value = { b: 1, a: { nested: true } };
    const expected = JSON.stringify(value, null, 2);
    expect(prettyJson(value)).toBe(expected);
  });

  it('stringifies arrays and primitives', () => {
    const arr = [1, 'x', true, null];
    expect(prettyJson(arr)).toBe(JSON.stringify(arr, null, 2));
    expect(prettyJson('hello')).toBe(JSON.stringify('hello', null, 2));
    expect(prettyJson(42)).toBe(JSON.stringify(42, null, 2));
    expect(prettyJson(false)).toBe(JSON.stringify(false, null, 2));
  });

  it('returns null for JSON null and undefined for undefined input', () => {
    // JSON.stringify(null) === 'null'
    expect(prettyJson(null)).toBe(JSON.stringify(null, null, 2));

    // JSON.stringify(undefined) === undefined
    expect(prettyJson(undefined)).toBeUndefined();
  });
});

