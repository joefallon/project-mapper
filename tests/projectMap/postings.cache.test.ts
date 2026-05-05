import { describe, it, expect } from 'vitest';
import { createPostingsAccumulator, addChunkToPostings } from '../../src/projectMap/build/postings';
import { setChunkTermCounts } from '../../src/projectMap/build/termCountsCache';
import { countTokenizedTerms } from '../../src/utils';

function postingsToPlain(obj: Map<string, Map<string, Array<any>>>) {
    const out: Record<string, Record<string, Array<any>>> = {};
    for (const [bucket, bucketMap] of obj.entries()) {
        out[bucket] = {};
        for (const term of bucketMap.keys()) {
            out[bucket][term] = bucketMap.get(term)!;
        }
    }
    return out;
}

describe('postings accumulation with cached term counts', () => {
    it('uses cached term counts when present', () => {
        const postings = createPostingsAccumulator();
        const chunk: any = { chunk_id: 'c0001', text: 'alpha alpha beta' };

        const counts = new Map<string, number>([['alpha', 2], ['beta', 1]]);
        setChunkTermCounts(chunk, counts);

        addChunkToPostings(postings, chunk);

        // Find alpha entry across buckets
        let foundAlpha = false;
        for (const [, bucketMap] of postings.entries()) {
            if (bucketMap.has('alpha')) {
                expect(bucketMap.get('alpha')).toEqual([{ chunk_id: 'c0001', tf: 2 }]);
                foundAlpha = true;
            }
        }
        expect(foundAlpha).toBe(true);
    });

    it('falls back to tokenizing text when cache is absent', () => {
        const postings = createPostingsAccumulator();
        const chunk: any = { chunk_id: 'c0002', text: 'gamma delta gamma' };

        // No cache set for this chunk
        addChunkToPostings(postings, chunk);

        let foundGamma = false;
        for (const [, bucketMap] of postings.entries()) {
            if (bucketMap.has('gamma')) {
                // Note: tokenization emits overlapping tokens and duplicates by design;
                // for a simple token like 'gamma' the effective tf from countTokenizedTerms
                // is 3 per raw occurrence (base + separatorPart + camelPart). With two
                // occurrences the expected tf is 6.
                expect(bucketMap.get('gamma')).toEqual([{ chunk_id: 'c0002', tf: 6 }]);
                foundGamma = true;
            }
        }
        expect(foundGamma).toBe(true);
    });

    it('produces identical postings when using precomputed counts vs recomputing', () => {
        const chunk: any = { chunk_id: 'c0003', text: 'alpha beta alpha' };
        // Precompute counts and attach as transient cache
        const counts = countTokenizedTerms(chunk.text);
        setChunkTermCounts(chunk, counts);

        const postingsWithCache = createPostingsAccumulator();
        addChunkToPostings(postingsWithCache, chunk);

        // Create a plain persisted-like clone without symbol-keyed cache
        const chunkClone = JSON.parse(JSON.stringify(chunk));
        const postingsNoCache = createPostingsAccumulator();
        addChunkToPostings(postingsNoCache, chunkClone);

        expect(postingsToPlain(postingsWithCache)).toEqual(postingsToPlain(postingsNoCache));
    });
});

