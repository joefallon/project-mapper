import {
    buildPreviewFromLines,
    normalizeWhitespace,
    countTokenizedTerms,
    topTermsFromCounts,
    extractQuotedStrings
} from './utils';
import { performance } from 'perf_hooks';
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
    // Diagnostic threshold (console-only). Adjust as needed for investigations.
    const SLOW_BUILD_CHUNK_RECORD_DIAGNOSTIC_THRESHOLD_MS = 1000;

    // Time subphases with performance.now(). We keep diagnostics local and
    // only print when the total elapsed exceeds the threshold.
    const t0 = performance.now();
    const slice = lines.slice(startLine - 1, endLine);
    const t1 = performance.now();

    const text = slice.join('\n');
    const t2 = performance.now();

    const preview = buildPreviewFromLines(slice);
    const t3 = performance.now();

    const normalizedPreview = normalizeWhitespace(preview);
    const t4 = performance.now();

    const termCounts = countTokenizedTerms(text);
    const t5 = performance.now();

    const topTerms = topTermsFromCounts(termCounts);
    const t6 = performance.now();

    const identifiers = extractIdentifiers(text);
    const t7 = performance.now();

    const keyLikeLines = extractKeyLikeLines(slice);
    const t8 = performance.now();

    const quotedStrings = extractQuotedStrings(text);
    const t9 = performance.now();

    const referencedPaths = extractReferencedPaths(text, knownBasenamesSet);
    const t10 = performance.now();

    const tFinal = performance.now();

    const dur = (a: number, b: number) => Math.max(0, b - a);
    const sliceMs = dur(t0, t1);
    const joinMs = dur(t1, t2);
    const previewMs = dur(t2, t3);
    const previewNormMs = dur(t3, t4);
    const termCountMs = dur(t4, t5);
    const topTermsMs = dur(t5, t6);
    const identifiersMs = dur(t6, t7);
    const keyLikeLinesMs = dur(t7, t8);
    const quotedStringsMs = dur(t8, t9);
    const referencedPathsMs = dur(t9, t10);
    const remainingMs = dur(t10, tFinal);
    const totalMs = dur(t0, tFinal);

    if (totalMs >= SLOW_BUILD_CHUNK_RECORD_DIAGNOSTIC_THRESHOLD_MS) {
        // Console-only diagnostic block for slow chunk records.
        // Keep the message compact enough to appear as a single block in logs.
        // eslint-disable-next-line no-console
        console.log(`\n=== SLOW BUILD CHUNK RECORD: ${relativeFilePath} ${chunkId} (${kind}) ===`);
        // eslint-disable-next-line no-console
        console.log(`title=${title || ''} start=${startLine} end=${endLine} lines=${slice.length} chars=${text.length} total_ms=${totalMs.toFixed(1)}`);
        // eslint-disable-next-line no-console
        console.log(`slice_ms=${sliceMs.toFixed(1)} join_ms=${joinMs.toFixed(1)} preview_ms=${previewMs.toFixed(1)} preview_norm_ms=${previewNormMs.toFixed(1)} term_count_ms=${termCountMs.toFixed(1)} top_terms_ms=${topTermsMs.toFixed(1)} identifiers_ms=${identifiersMs.toFixed(1)} keylike_ms=${keyLikeLinesMs.toFixed(1)} quoted_ms=${quotedStringsMs.toFixed(1)} referenced_ms=${referencedPathsMs.toFixed(1)} remaining_ms=${remainingMs.toFixed(1)}`);
        // counts
        // eslint-disable-next-line no-console
        console.log(`termCounts=${termCounts.size} topTerms=${topTerms.length} identifiers=${identifiers.length} keyLikeLines=${keyLikeLines.length} quotedStrings=${quotedStrings.length} referencedPaths=${referencedPaths.length}`);
        // eslint-disable-next-line no-console
        console.log('=== END SLOW BUILD CHUNK RECORD ===\n');
    }

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

