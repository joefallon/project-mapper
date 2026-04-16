import { describe, it, expect } from 'vitest';
import { buildChunkRecord } from '../src/buildChunkRecord';
import { buildPreviewFromLines, normalizeWhitespace } from '../src/utils';

describe('buildChunkRecord', () => {
    it('produces a full chunk record for a multi-line slice', () => {
        const lines = [
            'Title: Project Mapper',
            '',
            "apple apple apple",
            "banana banana",
            "function MyComponent() { return 'hello'; }",
            'See ./README.md and src/index.ts for details',
            'NAME = value',
            '"bye"',
        ];

        const result = buildChunkRecord({
            chunkId:          'c0001',
            fileId:           'f0001',
            relativeFilePath: 'src/file.ts',
            lines,
            startLine:        1,
            endLine:          lines.length,
            kind:             'code',
            title:            'Header Title',
        });

        expect(result.chunk_id).toBe('c0001');
        expect(result.file_id).toBe('f0001');
        expect(result.path).toBe('src/file.ts');
        expect(result.start_line).toBe(1);
        expect(result.end_line).toBe(lines.length);
        expect(result.line_count).toBe(lines.length);

        // text and preview
        const slice = lines.slice(0, lines.length);
        expect(result.text).toBe(slice.join('\n'));
        expect(result.preview).toBe(normalizeWhitespace(buildPreviewFromLines(slice)));

        // top terms: apple should be present with count >= 3 (tokenization emits overlapping tokens)
        const apple = result.top_terms.find((t) => t.term === 'apple');
        expect(apple).toBeDefined();
        expect(apple!.count).toBeGreaterThanOrEqual(3);

        // identifiers should include MyComponent
        expect(result.top_identifiers.some((i) => i.identifier === 'MyComponent')).toBe(true);

        // key-like lines should include the header and NAME assignment
        expect(result.key_like_lines).toContain('Title: Project Mapper');
        expect(result.key_like_lines).toContain('NAME = value');

        // quoted strings
        expect(result.quoted_strings).toContain('hello');
        expect(result.quoted_strings).toContain('bye');

        // referenced paths include README.md (normalized) and src/index.ts
        expect(result.referenced_paths).toContain('README.md');
        expect(result.referenced_paths).toContain('src/index.ts');
    });

    it('falls back to empty title when none provided', () => {
        const lines = ['single line'];
        const res = buildChunkRecord({
            chunkId:          'c2',
            fileId:           'f2',
            relativeFilePath: 'file.txt',
            lines,
            startLine:        1,
            endLine:          1,
            kind:             'txt',
            title:            undefined,
        });

        expect(res.title).toBe('');
        expect(res.line_count).toBe(1);
        expect(res.text).toBe('single line');
    });

    it('filters referenced paths with knownBasenamesSet', () => {
        const lines = ['See ./README.md and src/index.ts'];
        const known = new Set(['index.ts']);

        const res = buildChunkRecord({
            chunkId:           'c3',
            fileId:            'f3',
            relativeFilePath:  'file.txt',
            lines,
            startLine:         1,
            endLine:           1,
            kind:              'txt',
            knownBasenamesSet: known,
        });

        expect(res.referenced_paths).toEqual(['src/index.ts']);
    });
});


