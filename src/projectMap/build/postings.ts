import { PostingsAccumulator } from '../types';
import { countTokenizedTerms, bucketForTerm } from '../../utils';
import { writeJson } from '../io';
import path from 'path';

export function createPostingsAccumulator(): PostingsAccumulator {
    return new Map();
}

export function addChunkToPostings(postings: PostingsAccumulator, chunkRecord: any) {
    const fullCounts = countTokenizedTerms(chunkRecord.text);

    for(const [term, tf] of fullCounts.entries()) {
        const bucket = bucketForTerm(term);

        if(!postings.has(bucket)) {
            postings.set(bucket, new Map());
        }

        const bucketMap = postings.get(bucket)!;

        if(!bucketMap.has(term)) {
            bucketMap.set(term, [] as Array<{ chunk_id: string; tf: number }>);
        }

        bucketMap.get(term)!.push({chunk_id: chunkRecord.chunk_id, tf});
    }
}

export async function persistPostings(postings: PostingsAccumulator, postingsDir: string) {
    for(const [bucket, bucketMap] of postings.entries()) {
        const bucketObject: Record<string, any> = {};
        const sortedTerms = [...bucketMap.keys()].sort((left, right) => left.localeCompare(right));

        for(const term of sortedTerms) {
            bucketObject[term] = bucketMap.get(term);
        }

        await writeJson(path.join(postingsDir, `${bucket}.json`), bucketObject);
    }
}

