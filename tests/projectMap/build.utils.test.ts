import { describe, it, expect } from 'vitest';
import {
    parentDirectoriesForFile,
    createDirectoryAccumulator,
    incrementCounterObject,
    mergeTopTermsIntoMap,
    buildKnownBasenamesSet,
    sortCounterObject
} from '../../src/projectMap/build/utils';

describe('build utils', () => {
    it('parentDirectoriesForFile basic', () => {
        expect(parentDirectoriesForFile('file.txt')).toEqual(['.']);
        expect(parentDirectoriesForFile('src/file.txt')).toEqual(['.', 'src']);
        expect(parentDirectoriesForFile('a/b/c.txt')).toEqual(['.', 'a', 'a/b']);
    });

    it('parentDirectoriesForFile edge cases', () => {
        // trailing slash
        expect(parentDirectoriesForFile('a/b/')).toEqual(['.', 'a', 'a/b']);
        // repeated separators - match original behavior (no normalization)
        expect(parentDirectoriesForFile('a//b///c.txt')).toEqual(['.', 'a', 'a/', 'a//b', 'a//b/', 'a//b//']);
    });

    it('createDirectoryAccumulator and incrementCounterObject and sortCounterObject', () => {
        const acc = createDirectoryAccumulator('d000001', 'src');
        expect(acc.dir_id).toBe('d000001');
        expect(acc.path).toBe('src');
        expect(acc.recursive_file_count).toBe(0);

        incrementCounterObject(acc.extension_counts, '.ts');
        incrementCounterObject(acc.extension_counts, '.ts');
        incrementCounterObject(acc.extension_counts, '.js');

        const sorted = sortCounterObject(acc.extension_counts);
        expect(Object.keys(sorted)).toEqual(['.ts', '.js']);
        expect(sorted['.ts']).toBe(2);
    });

    it('mergeTopTermsIntoMap and buildKnownBasenamesSet', () => {
        const m = new Map();
        mergeTopTermsIntoMap(m, [{term: 'foo', count: 2}, {term: 'bar', count: 1}]);
        mergeTopTermsIntoMap(m, [{term: 'foo', count: 3}]);
        expect(m.get('foo')).toBe(5);
        expect(m.get('bar')).toBe(1);

        const set = buildKnownBasenamesSet(['a/b/c.txt', 'd/e/file.js']);
        expect(set.has('c.txt')).toBe(true);
        expect(set.has('file.js')).toBe(true);
    });
});

