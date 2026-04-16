import { detectBoundaries } from './boundary';
import { Chunk, splitLargeRangeIntoWindows } from './chunking';

/**
 * Ported buildChunkRanges from project-map.mjs
 */
export function buildChunkRanges(lines: string[]): Chunk[] {
    if(lines.length === 0) {
        return [];
    }

    const boundaries = detectBoundaries(lines);

    // If the only boundary is the start of the file, the structure signals are weak.
    // Fall back to fixed-window chunking.
    if(boundaries.length <= 1) {
        return splitLargeRangeIntoWindows(lines, 1, lines.length, undefined, 'window');
    }

    const chunkRanges: Chunk[] = [];

    for(let index = 0; index < boundaries.length; index += 1) {
        const currentBoundary = boundaries[index];
        const nextBoundary = boundaries[index + 1];
        const startLine = currentBoundary.startLine;
        const endLine = nextBoundary ? nextBoundary.startLine - 1 : lines.length;

        if(startLine > endLine) {
            continue;
        }

        const splitRanges = splitLargeRangeIntoWindows(
            lines,
            startLine,
            endLine,
            currentBoundary.title,
            currentBoundary.kind,
        );

        chunkRanges.push(...splitRanges);
    }

    return chunkRanges;
}

