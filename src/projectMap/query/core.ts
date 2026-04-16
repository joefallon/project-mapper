import { normalizeWhitespace, tokenizeText, hasText } from '../../utils';
import { getPaths } from '../constants';
import { readJson, writeJson } from '../io';
import path from 'path';
import { loadCoreState } from '../state';

export function normalizeQuery(query: string) {
    const normalizedQueryText = normalizeWhitespace(String(query ?? ''));
    const queryTerms = [...new Set(tokenizeText(normalizedQueryText))];
    return {
        original:        String(query ?? ''),
        normalized_text: normalizedQueryText,
        terms:           queryTerms,
    };
}

export function scoreChunkForQuery({chunkRecord, fileRecord, query, postingsByTerm}: any) {
    let score = 0;
    const reasons: string[] = [];
    const matchedTerms: string[] = [];
    const chunkTextLower = chunkRecord.text.toLowerCase();
    const chunkTitleLower = (chunkRecord.title || '').toLowerCase();
    const filePathLower = (fileRecord.path || '').toLowerCase();

    for(const term of query.terms) {
        const postingEntries = postingsByTerm.get(term) ?? [];
        const matchingPosting = postingEntries.find((entry: any) => entry.chunk_id === chunkRecord.chunk_id);

        if(!matchingPosting) {
            continue;
        }

        matchedTerms.push(term);
        score += 3;
        score += Math.min(6, Math.log2(matchingPosting.tf + 1) * 2);
    }

    if(matchedTerms.length > 0) {
        reasons.push(`matched ${matchedTerms.length} query term(s)`);
    }

    if(query.normalized_text && chunkTextLower.includes(query.normalized_text.toLowerCase())) {
        score += 10;
        reasons.push('exact phrase match');
    }

    if(hasText(chunkRecord.title) && query.terms.some((term: string) => chunkTitleLower.includes(term))) {
        score += 6;
        reasons.push('title/section match');
    }

    if(query.terms.some((term: string) => filePathLower.includes(term))) {
        score += 5;
        reasons.push('path match');
    }

    if(matchedTerms.length === query.terms.length && query.terms.length > 1) {
        score += 8;
        reasons.push('all query terms present');
    }

    const identifierStrings = (chunkRecord.top_identifiers ?? []).map((item: any) => (item.identifier || '').toLowerCase());
    if(query.terms.some((term: string) => identifierStrings.includes(term))) {
        score += 4;
        reasons.push('identifier match');
    }

    if(fileRecord.file_class === 'test' && query.terms.some((term: string) => /test|spec/.test(term))) {
        score += 2;
        reasons.push('test-class boost');
    }

    if(fileRecord.file_class === 'doc' && query.terms.some((term: string) => /room|encounter|guide|manual|docs?|lore|campaign/.test(term))) {
        score += 2;
        reasons.push('doc-class boost');
    }

    if(fileRecord.file_class === 'config' && query.terms.some((term: string) => /config|setting|env|yaml|json/.test(term))) {
        score += 2;
        reasons.push('config-class boost');
    }

    const density = matchedTerms.length / Math.max(1, chunkRecord.line_count);
    score += density * 10;

    return {
        chunk_id:      chunkRecord.chunk_id,
        file_id:       fileRecord.file_id,
        path:          fileRecord.path,
        title:         chunkRecord.title,
        kind:          chunkRecord.kind,
        start_line:    chunkRecord.start_line,
        end_line:      chunkRecord.end_line,
        preview:       chunkRecord.preview,
        matched_terms: matchedTerms,
        score,
        reasons:       [...new Set(reasons)],
    };
}

export async function loadRelevantPostings(queryTerms: string[], projectRoot?: string) {
    const paths = getPaths(projectRoot);
    const bucketsNeeded = [...new Set(queryTerms.map((t) => {
        const first = t[0] ?? '';
        if(/[a-z]/.test(first)) {
            return first;
        }
        if(/[0-9]/.test(first)) {
            return 'num';
        }
        return 'other';
    }))];

    const postings = new Map();

    for(const bucket of bucketsNeeded) {
        const bucketPath = path.join(paths.POSTINGS_DIR, `${bucket}.json`);

        try {
            const bucketData = await readJson(bucketPath);
            for(const [term, postingEntries] of Object.entries(bucketData)) {
                postings.set(term, postingEntries as any);
            }
        } catch {
            // ignore missing buckets
        }
    }

    return postings;
}

export async function runQuery(queryText: string, projectRoot?: string) {
    const state = await loadCoreState(projectRoot);
    const query = normalizeQuery(queryText);

    if(query.terms.length === 0) {
        return {
            state,
            query,
            topChunks:    [],
            topFiles:     [],
            relatedFiles: [],
        };
    }

    const postings = await loadRelevantPostings(query.terms, projectRoot);
    const postingsByTerm = new Map();
    const candidateChunkIds = new Set<string>();

    for(const term of query.terms) {
        const postingEntries = postings.get(term) ?? [];
        postingsByTerm.set(term, postingEntries);

        for(const entry of postingEntries) {
            candidateChunkIds.add(entry.chunk_id);
        }
    }

    const chunkScores: any[] = [];

    for(const chunkId of candidateChunkIds) {
        const chunkRecord = state.chunksById.get(chunkId);
        if(!chunkRecord) {
            continue;
        }
        const fileRecord = state.filesById.get(chunkRecord.file_id);
        if(!fileRecord || !fileRecord.indexed) {
            continue;
        }

        const scoredChunk = scoreChunkForQuery({chunkRecord, fileRecord, query, postingsByTerm});
        if(scoredChunk.score > 0) {
            chunkScores.push(scoredChunk);
        }
    }

    chunkScores.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.start_line - right.start_line);

    const fileScoresMap = new Map();

    for(const chunkScore of chunkScores) {
        const existing = fileScoresMap.get(chunkScore.file_id) ?? {
            file_id:     chunkScore.file_id,
            path:        chunkScore.path,
            score:       0,
            reasons:     new Set(),
            best_chunks: [],
        };

        existing.best_chunks.push(chunkScore);
        existing.best_chunks.sort((left: any, right: any) => right.score - left.score);
        existing.best_chunks = existing.best_chunks.slice(0, 3);
        existing.score = existing.best_chunks.reduce((sum: number, item: any) => sum + item.score, 0);

        for(const reason of chunkScore.reasons) {
            existing.reasons.add(reason);
        }
        fileScoresMap.set(chunkScore.file_id, existing);
    }

    const topFiles = [...fileScoresMap.values()]
        .map((fileScore: any) => {
            const fileRecord = state.filesById.get(fileScore.file_id);
            return {
                file_id:     fileScore.file_id,
                path:        fileScore.path,
                file_class:  fileRecord?.file_class ?? 'unknown',
                chunk_count: fileRecord?.chunk_count ?? 0,
                preview:     fileRecord?.preview ?? '',
                score:       fileScore.score,
                reasons:     [...fileScore.reasons],
                best_chunks: fileScore.best_chunks.map((chunk: any) => ({
                    chunk_id:   chunk.chunk_id,
                    start_line: chunk.start_line,
                    end_line:   chunk.end_line,
                    title:      chunk.title,
                    score:      chunk.score,
                })),
            };
        })
        .sort((left: any, right: any) => right.score - left.score || left.path.localeCompare(right.path));

    const relatedFiles: any[] = [];

    return {
        state,
        query,
        topChunks: chunkScores.slice(0, 12),
        topFiles:  topFiles.slice(0, 8),
        relatedFiles,
    };
}

export async function persistQueryArtifact(kind: string, queryText: string, payload: unknown, projectRoot?: string) {
    const paths = getPaths(projectRoot);
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${kind}_${String(queryText).replace(/[^a-z0-9._-]+/gi, '-')}.json`;
    await writeJson(path.join(paths.QUERIES_DIR, fileName), payload);
}

export function makePersistableQueryResult(result: any) {
    return {
        query:        result.query,
        topFiles:     result.topFiles,
        topChunks:    result.topChunks,
        relatedFiles: result.relatedFiles,
    };
}
