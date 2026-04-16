import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/classifyFile';

describe('classifyFile', () => {
    it('returns binary when isTextFile is false', () => {
        expect(classifyFile('images/logo.png', '.png', false)).toBe('binary');
    });

    it('returns generated for generated file patterns', () => {
        expect(classifyFile('dist/app.min.js', '.js', true)).toBe('generated');
        expect(classifyFile('some/thing.map', '.map', true)).toBe('generated');
    });

    it('returns test when path contains test hints', () => {
        expect(classifyFile('src/foo.test.ts', '.ts', true)).toBe('test');
        expect(classifyFile('lib/__tests__/bar.js', '.js', true)).toBe('test');
    });

    it('returns doc for doc extensions and hints', () => {
        expect(classifyFile('README.md', '.md', true)).toBe('doc');
        expect(classifyFile('docs/guide.txt', '.txt', true)).toBe('doc');
    });

    it('returns config for config extensions and hints', () => {
        expect(classifyFile('config/settings.yaml', '.yaml', true)).toBe('config');
        // filenames containing the token "config" are treated as config by the
        // original heuristic (e.g. app.config.js)
        expect(classifyFile('src/app.config.js', '.js', true)).toBe('config');
    });

    it('returns data for data extensions', () => {
        expect(classifyFile('data/export.csv', '.csv', true)).toBe('data');
    });

    it('returns script for script extensions', () => {
        expect(classifyFile('scripts/run.sh', '.sh', true)).toBe('script');
        expect(classifyFile('ops/deploy.ps1', '.ps1', true)).toBe('script');
    });

    it('returns source for known source extensions', () => {
        expect(classifyFile('src/main.ts', '.ts', true)).toBe('source');
        expect(classifyFile('app/index.js', '.js', true)).toBe('source');
    });

    it('returns unknown for text files without matching extension/hints', () => {
        expect(classifyFile('Makefile', '', true)).toBe('unknown');
        // note: 'notes' is included in DOC_HINTS so this becomes 'doc'
        expect(classifyFile('notes/untitled', '', true)).toBe('doc');
    });

    it('prefers binary when isTextFile=false even if extension present', () => {
        expect(classifyFile('src/main.ts', '.ts', false)).toBe('binary');
    });
});


