import { describe, it, expect } from 'vitest';
import { setChunkTermCounts, getChunkTermCounts } from '../../src/projectMap/build/termCountsCache';

describe('termCounts transient cache', () => {
    it('sets and gets a Map on a chunk object and does not serialize', () => {
        const chunk: any = { chunk_id: 'c0001' };
        const counts = new Map<string, number>([['alpha', 2], ['beta', 1]]);

        setChunkTermCounts(chunk, counts);

        const got = getChunkTermCounts(chunk);
        expect(got).toBe(counts);

        // Symbol-keyed properties should not appear in JSON serialization
        const serialized = JSON.stringify(chunk);
        expect(serialized).toBe(JSON.stringify({ chunk_id: 'c0001' }));
    });
});

