import {
    buildPreviewFromLines,
    normalizeWhitespace,
    countTokenizedTerms,
    topTermsFromCounts,
    extractQuotedStrings
} from './utils';
import { extractIdentifiers } from './text/identifiers';
import { extractKeyLikeLines } from './extractKeyLikeLines';
import { extractReferencedPaths } from './extractReferencedPaths';
import type { IdentifierCount } from './text/types';

export type BuildChunkRecordArgs = {
    chunkId: string;
    fileId: string;
    relativeFilePath: string;
    lines: string[];
    startLine: number; // 1-based inclusive
    endLine: number; // 1-based inclusive
    kind: string;
    title?: string | null;
    knownBasenamesSet?: Set<string>;
};

export type TopTerm = { term: string; count: number };

export type ChunkRecord = {
    chunk_id: string;
    file_id: string;
    path: string;
    start_line: number;
    end_line: number;
    kind: string;
    title: string;
    preview: string;
    text: string;
    line_count: number;
    top_terms: TopTerm[];
    top_identifiers: IdentifierCount[];
    key_like_lines: string[];
    quoted_strings: string[];
    referenced_paths: string[];
};

/**
 * Port of buildChunkRecord from project-map.mjs — creates a compact chunk record
 * from a chunk line range. Uses existing src/ helpers to produce preview, terms,
 * identifiers and references.
 */
export function buildChunkRecord({
                                     chunkId,
                                     fileId,
                                     relativeFilePath,
                                     lines,
                                     startLine,
                                     endLine,
                                     kind,
                                     title,
                                     knownBasenamesSet,
                                 }: BuildChunkRecordArgs): ChunkRecord {
    const slice = lines.slice(startLine - 1, endLine);
    const text = slice.join('\n');
    const preview = buildPreviewFromLines(slice);
    const normalizedPreview = normalizeWhitespace(preview);
    const termCounts = countTokenizedTerms(text);
    const topTerms = topTermsFromCounts(termCounts);
    const identifiers = extractIdentifiers(text);
    const keyLikeLines = extractKeyLikeLines(slice);
    const quotedStrings = extractQuotedStrings(text);
    const referencedPaths = extractReferencedPaths(text, knownBasenamesSet);

    return {
        chunk_id:         chunkId,
        file_id:          fileId,
        path:             relativeFilePath,
        start_line:       startLine,
        end_line:         endLine,
        kind,
        title:            title || '',
        preview:          normalizedPreview,
        text,
        line_count:       endLine - startLine + 1,
        top_terms:        topTerms,
        top_identifiers:  identifiers,
        key_like_lines:   keyLikeLines,
        quoted_strings:   quotedStrings,
        referenced_paths: referencedPaths,
    };
}

