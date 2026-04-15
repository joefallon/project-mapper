import { describe, it, expect } from 'vitest';
import path from 'path';
import { toRelativeProjectPath } from '../src/utils';

describe('toRelativeProjectPath', () => {
  it('returns "." for the project root itself', () => {
    const projectRoot = path.resolve('test-root');
    const absolute = projectRoot;

    expect(toRelativeProjectPath(absolute, projectRoot)).toBe('.');
  });

  it('returns nested relative paths using posix separators', () => {
    const projectRoot = path.resolve('test-root');
    const absolute = path.join(projectRoot, 'dir', 'sub', 'file.txt');
    const expected = path.relative(projectRoot, absolute).replace(/\\/g, '/');
    expect(toRelativeProjectPath(absolute, projectRoot)).toBe(expected);
  });

  it('returns parent/.. style relative paths when outside project root', () => {
    const projectRoot = path.resolve('test-root', 'a', 'b');
    const absolute = path.join(projectRoot, '..', '..', 'other', 'x.txt');
    const expected = path.relative(projectRoot, absolute).replace(/\\/g, '/');
    expect(toRelativeProjectPath(absolute, projectRoot)).toBe(expected);
  });
});

