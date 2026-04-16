import { describe, it, expect } from 'vitest';
import { chunkTextFile } from '../src/chunkTextFile';

describe('chunkTextFile', () => {
    it('splits LF and CRLF the same and returns chunks', () => {
        const textLF = 'a\nb\nc';
        const textCRLF = 'a\r\nb\r\nc';

        const gen1 = (() => {
            let i = 0;
            return () => `c${String(++i).padStart(4, '0')}`;
        })();

        const r1 = chunkTextFile({
            fileId:           'f1',
            relativeFilePath: 'x.txt',
            text:             textLF,
            chunkIdGenerator: gen1
        });
        const gen2 = (() => {
            let i = 0;
            return () => `c${String(++i).padStart(4, '0')}`;
        })();
        const r2 = chunkTextFile({
            fileId:           'f1',
            relativeFilePath: 'x.txt',
            text:             textCRLF,
            chunkIdGenerator: gen2
        });

        expect(r1.lines).toEqual(['a', 'b', 'c']);
        expect(r2.lines).toEqual(['a', 'b', 'c']);

        // Both should produce at least one chunk and chunk ids from generator
        expect(r1.chunks.length).toBeGreaterThanOrEqual(1);
        expect(r1.chunks[0].chunk_id).toBe('c0001');
        expect(r2.chunks[0].chunk_id).toBe('c0001');
    });

    it('forwards knownBasenamesSet so referenced_paths are filtered', () => {
        const text = 'See ./lib/foo.js and other.txt';
        const generator = (() => {
            let i = 0;
            return () => `c${String(++i).padStart(4, '0')}`;
        })();
        const known = new Set(['foo.js']);

        const result = chunkTextFile({
            fileId:            'f2',
            relativeFilePath:  'file.md',
            text,
            knownBasenamesSet: known,
            chunkIdGenerator:  generator
        });

        expect(result.chunks.length).toBeGreaterThanOrEqual(1);
        // referenced_paths should include lib/foo.js because basename foo.js is in known set
        const refs = result.chunks[0].referenced_paths;
        expect(refs).toContain('lib/foo.js');
        // should not include other.txt because basename not in known set
        expect(refs).not.toContain('other.txt');
    });

    it('produces multiple window chunks for large files and uses chunkIdGenerator for each chunk', () => {
        // Create 200 lines to trigger windowing into multiple chunks (FALLBACK_CHUNK_LINES=80)
        const lines = new Array(200).fill(0).map((_, i) => `line ${i + 1}`);
        const text = lines.join('\n');

        let callCount = 0;
        const generator = () => {
            callCount += 1;
            return `c${String(callCount).padStart(4, '0')}`;
        };

        const result = chunkTextFile({
            fileId:           'f3',
            relativeFilePath: 'big.txt',
            text,
            chunkIdGenerator: generator
        });

        // Expect multiple chunks (computed by splitLargeRangeIntoWindows: should be 3 for 200 lines)
        expect(result.chunks.length).toBe(3);
        expect(callCount).toBe(3);
        expect(result.chunks.map((c) => c.chunk_id)).toEqual(['c0001', 'c0002', 'c0003']);
    });
});

