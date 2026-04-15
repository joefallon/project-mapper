import { describe, it, expect } from 'vitest';
import { looksGenerated } from '../src/looksGenerated';

describe('looksGenerated', () => {
  it('matches common generated filenames', () => {
    expect(looksGenerated('foo.min.js')).toBe(true);
    expect(looksGenerated('dist/foo.min.css')).toBe(true);
    expect(looksGenerated('some/path/file.js.map')).toBe(true);
    expect(looksGenerated('package-lock.json')).toBe(true);
    expect(looksGenerated('sub/dir/pnpm-lock.yaml')).toBe(true);
    expect(looksGenerated('pnpm-lock.yml')).toBe(true);
    expect(looksGenerated('yarn.lock')).toBe(true);
    expect(looksGenerated('composer.lock')).toBe(true);
    expect(looksGenerated('diff.diff')).toBe(true);
    expect(looksGenerated('Cargo.lock')).toBe(true);
    expect(looksGenerated('poetry.lock')).toBe(true);
  });

  it('is case-insensitive and matches in paths', () => {
    expect(looksGenerated('FOO.MIN.JS')).toBe(true);
    expect(looksGenerated('some/PATH/package-lock.json')).toBe(true);
  });

  it('does not false-positive on similar but non-generated names', () => {
    expect(looksGenerated('src/index.ts')).toBe(false);
    expect(looksGenerated('README.md')).toBe(false);
    expect(looksGenerated('package.json')).toBe(false);
    // ensure words like 'mineral' do not match
    expect(looksGenerated('notes/mineral.txt')).toBe(false);
  });

  it('matches chained extensions like foo.min.js.map', () => {
    expect(looksGenerated('foo.min.js.map')).toBe(true);
  });
});

