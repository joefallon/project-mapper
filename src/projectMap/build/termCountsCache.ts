// Transient in-memory cache for per-chunk term counts.
// We intentionally attach the cache as a Symbol-keyed property on the chunk
// object so it is not enumerated or serialized when chunk records are
// persisted (JSON.stringify ignores symbol-keyed properties).
export const TERM_COUNTS_SYMBOL = Symbol('termCounts');

export function setChunkTermCounts(chunk: any, counts: Map<string, number>) {
    // Attach as a Symbol-keyed property so JSON.stringify and normal string-key
    // enumeration do not include it.
    (chunk as any)[TERM_COUNTS_SYMBOL] = counts;
}

export function getChunkTermCounts(chunk: any): Map<string, number> | undefined {
    return (chunk as any)[TERM_COUNTS_SYMBOL];
}

