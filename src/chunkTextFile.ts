import { buildChunkRanges } from './chunkRanges';
import { buildChunkRecord, ChunkRecord } from './buildChunkRecord';

export type ChunkTextFileArgs = {
    fileId: string;
    relativeFilePath: string;
    text: string;
    knownBasenamesSet?: Set<string>;
    chunkIdGenerator: () => string;
};

export function chunkTextFile({
                                  fileId,
                                  relativeFilePath,
                                  text,
                                  knownBasenamesSet,
                                  chunkIdGenerator,
                              }: ChunkTextFileArgs): { lines: string[]; chunks: ChunkRecord[] } {
    const lines = text.split(/\r?\n/);
    const chunkRanges = buildChunkRanges(lines);
    const chunks: ChunkRecord[] = [];

    for(const chunkRange of chunkRanges) {
        const chunkId = chunkIdGenerator();
        chunks.push(buildChunkRecord({
            chunkId,
            fileId,
            relativeFilePath,
            lines,
            startLine: chunkRange.startLine,
            endLine:   chunkRange.endLine,
            kind:      chunkRange.kind,
            title:     chunkRange.title,
            knownBasenamesSet,
        }));
    }

    return {lines, chunks};
}

