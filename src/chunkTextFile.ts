import { buildChunkRanges } from './chunkRanges';
import { buildChunkRecord, ChunkRecord } from './buildChunkRecord';
import { performance } from 'node:perf_hooks';

export type ChunkTextFileArgs = {
    fileId: string;
    relativeFilePath: string;
    text: string;
    knownBasenamesSet?: Set<string>;
    chunkIdGenerator: () => string;
};

// Diagnostic threshold: only print detailed timings for files that exceed this
// total chunking time. Keep this local and conservative to avoid noisy logs.
const SLOW_CHUNK_FILE_DIAGNOSTIC_THRESHOLD_MS = 1000;

export function chunkTextFile({
                                  fileId,
                                  relativeFilePath,
                                  text,
                                  knownBasenamesSet,
                                  chunkIdGenerator,
                              }: ChunkTextFileArgs): { lines: string[]; chunks: ChunkRecord[] } {
    const totalStart = performance.now();

    const lineStart = performance.now();
    const lines = text.split(/\r?\n/);
    const lineElapsed = performance.now() - lineStart;

    const boundaryStart = performance.now();
    const chunkRanges = buildChunkRanges(lines);
    const boundaryElapsed = performance.now() - boundaryStart;

    const chunks: ChunkRecord[] = [];

    // Measure total time spent inside buildChunkRecord invocations and
    // aggregate per-chunk timings so we can report avg/max and the slowest
    // chunk's identifying info.
    const loopStart = performance.now();
    let totalBuildRecordMs = 0;
    let maxBuildRecordMs = 0;
    let slowestChunkInfo: { title?: string | null; kind: string; startLine: number; endLine: number; elapsedMs: number } | null = null;

    for (const chunkRange of chunkRanges) {
        const chunkId = chunkIdGenerator();
        const buildStart = performance.now();
        const rec = buildChunkRecord({
            chunkId,
            fileId,
            relativeFilePath,
            lines,
            startLine: chunkRange.startLine,
            endLine:   chunkRange.endLine,
            kind:      chunkRange.kind,
            title:     chunkRange.title,
            knownBasenamesSet,
        });
        const buildElapsed = performance.now() - buildStart;
        totalBuildRecordMs += buildElapsed;
        if (buildElapsed > maxBuildRecordMs) {
            maxBuildRecordMs = buildElapsed;
            slowestChunkInfo = {
                title: rec.title,
                kind: rec.kind,
                startLine: rec.start_line,
                endLine: rec.end_line,
                elapsedMs: buildElapsed,
            };
        }
        chunks.push(rec);
    }

    const loopElapsed = performance.now() - loopStart;
    const chunkRangeConstructionMs = Math.max(0, loopElapsed - totalBuildRecordMs);

    const totalElapsed = performance.now() - totalStart;
    const remainingOverhead = Math.max(0, totalElapsed - (lineElapsed + boundaryElapsed + loopElapsed));

    // Only print diagnostics for slow files to avoid noise in normal builds.
    if (totalElapsed >= SLOW_CHUNK_FILE_DIAGNOSTIC_THRESHOLD_MS) {
        const charCount = text.length;
        const lineCount = lines.length;
        const boundaryCount = chunkRanges.length;
        const chunkRangeCount = chunkRanges.length;
        const finalChunkCount = chunks.length;

        const avgBuildMs = finalChunkCount > 0 ? totalBuildRecordMs / finalChunkCount : 0;

        console.log('SLOW CHUNK FILE DIAGNOSTIC');
        console.log(`- path: ${relativeFilePath}`);
        console.log(`- size_chars: ${charCount} chars | lines: ${lineCount}`);
        console.log(`- boundaries: ${boundaryCount} | chunk_ranges: ${chunkRangeCount} | final_chunks: ${finalChunkCount}`);
        console.log(`- totals: ${totalElapsed.toFixed(1)} ms (lines=${lineElapsed.toFixed(1)} ms boundaries=${boundaryElapsed.toFixed(1)} ms chunk_ranges=${chunkRangeConstructionMs.toFixed(1)} ms build_records_total=${totalBuildRecordMs.toFixed(1)} ms remaining_overhead=${remainingOverhead.toFixed(1)} ms)`);
        console.log(`- build_records: total=${totalBuildRecordMs.toFixed(1)} ms avg=${avgBuildMs.toFixed(1)} ms max=${maxBuildRecordMs.toFixed(1)} ms`);
        if (slowestChunkInfo) {
            console.log(`- slowest_chunk: ${slowestChunkInfo.elapsedMs.toFixed(1)} ms | kind=${slowestChunkInfo.kind} | title=${String(slowestChunkInfo.title || '')} | start=${slowestChunkInfo.startLine} end=${slowestChunkInfo.endLine}`);
        }
    }

    return {lines, chunks};
}

