import { describe, it, expect } from 'vitest';
import { buildChunkRanges } from '../src/chunkRanges';
import { FALLBACK_CHUNK_LINES, FALLBACK_CHUNK_OVERLAP, STRUCTURE_MAX_SECTION_LINES } from '../src/chunking';

describe('buildChunkRanges', () => {
    it('returns empty array for empty input', () => {
        expect(buildChunkRanges([])).toHaveLength(0);
    });

    it('uses fallback windows when boundaries are weak', () => {
        const total = 200;
        const lines = new Array(total).fill('x');
        const chunks = buildChunkRanges(lines);

        expect(chunks.length).toBeGreaterThanOrEqual(1);

        // First window
        expect(chunks[0].startLine).toBe(1);
        expect(chunks[0].endLine).toBe(FALLBACK_CHUNK_LINES);
        expect(chunks[0].kind).toBe('window');
        expect(chunks[0].title).toBe('window 1');

        // Second window should start at windowEnd - overlap + 1
        if(chunks.length > 1) {
            expect(chunks[1].startLine).toBe(FALLBACK_CHUNK_LINES - FALLBACK_CHUNK_OVERLAP + 1);
        }

        // Last window should end at total
        expect(chunks[chunks.length - 1].endLine).toBe(total);
    });

    it('converts detected boundaries into sections with titles', () => {
        const lines = [
            '# A',
            'line a1',
            'line a2',
            '## B',
            'line b1',
        ];

        const chunks = buildChunkRanges(lines);
        expect(chunks.length).toBe(2);

        expect(chunks[0]).toEqual({startLine: 1, endLine: 3, kind: 'heading', title: 'A'});
        expect(chunks[1]).toEqual({startLine: 4, endLine: 5, kind: 'heading', title: 'B'});
    });

    it('splits a large structured section into parts', () => {
        const longBodyLines = 200; // bigger than STRUCTURE_MAX_SECTION_LINES (160)
        const lines: string[] = [];
        // Heading A at start
        lines.push('# Long Section');
        for(let i = 0; i < longBodyLines; i++) {
            lines.push('x');
        }
        // Second boundary
        lines.push('## Next');
        lines.push('tail');

        const chunks = buildChunkRanges(lines);

        // There should be multiple chunks for the first (large) section
        // First chunk corresponds to the long section's first window
        expect(chunks.length).toBeGreaterThan(2);

        // First chunk title should start with the header title and include part 1
        expect(chunks[0].title).toBe('Long Section (part 1)');
        // Kinds for the split parts should use heading-part (inherited kind is 'heading')
        expect(chunks[0].kind).toBe('heading-part');

        // Last chunk before the 'Next' boundary should end at the line before that boundary
        const nextBoundaryIndex = lines.findIndex((l) => l.startsWith('## Next'));
        const lastBeforeNext = chunks.find((c) => c.endLine === nextBoundaryIndex);
        expect(lastBeforeNext).toBeDefined();
    });
});


