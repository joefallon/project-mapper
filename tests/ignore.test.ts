import { describe, it, expect } from 'vitest';
import { isUnderIgnoredRelativeDirectory, shouldIgnoreDirectory } from '../src/ignore';

describe('ignore helpers', () => {
  it('recognizes exact ignored relative directories', () => {
    expect(isUnderIgnoredRelativeDirectory('.ai/scale')).toBe(true);
    expect(isUnderIgnoredRelativeDirectory('.ai/scale/state')).toBe(true);
  });

  it('recognizes nested paths under ignored relative directories', () => {
    expect(isUnderIgnoredRelativeDirectory('.ai/scale/state/nested')).toBe(true);
  });

  it('normalizes leading ./ and matches', () => {
    expect(isUnderIgnoredRelativeDirectory('./.ai/scale')).toBe(true);
  });

  it('does not false-positive on similar prefixes', () => {
    expect(isUnderIgnoredRelativeDirectory('.ai/scalefake')).toBe(false);
    expect(isUnderIgnoredRelativeDirectory('.ai/scales')).toBe(false);
  });

  it('treats root "." as not ignored by default', () => {
    expect(isUnderIgnoredRelativeDirectory('.')).toBe(false);
  });

  it('shouldIgnoreDirectory returns true for ignored basenames', () => {
    expect(shouldIgnoreDirectory('.', '.git')).toBe(true);
  });

  it('shouldIgnoreDirectory returns false for normal directories', () => {
    expect(shouldIgnoreDirectory('src', 'src')).toBe(false);
  });
});

