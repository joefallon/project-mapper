import { normalizeWhitespace, tokenizeText, hasText, safeSlug } from '../../utils';
import { getPaths } from '../constants';
import { readJson, writeJson } from '../io';
import path from 'path';
import { loadCoreState } from '../state';
import { extractReferencedPaths } from '../../extractReferencedPaths';

const QUERY_ARTIFACT_SLUG_MAX_LENGTH = 80;

function normalizeRepoPath(value: string) {
    return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isTestLikePath(filePath: string, fileClass?: string) {
    return fileClass === 'test'
        || /(^|\/)(__tests__|tests?|test)(\/|$)/i.test(filePath)
        || /\.test\./i.test(filePath)
        || /\.spec\./i.test(filePath);
}

function pathStem(filePath: string) {
    const normalized = normalizeRepoPath(filePath);
    const baseName = path.posix.basename(normalized).replace(/\.[^.\/]+$/, '').replace(/\.(test|spec)$/i, '');
    return baseName.toLowerCase();
}

function pathStemTokens(filePath: string) {
    return pathStem(filePath)
        .split(/[^a-z0-9]+/i)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 1);
}

function titleTokens(value: string) {
    return tokenizeText(value).map((token) => token.toLowerCase());
}

function addRelatedCandidate(candidateMap: Map<string, any>, fileRecord: any, reason: string, score: number) {
    if(!fileRecord || !fileRecord.indexed) {
        return;
    }

    const existing = candidateMap.get(fileRecord.path) ?? {
        path: fileRecord.path,
        file_id: fileRecord.file_id,
        file_class: fileRecord.file_class,
        preview: fileRecord.preview || '',
        score: 0,
        reasons: new Set<string>(),
    };

    existing.score += score;
    existing.reasons.add(reason);
    if(!hasText(existing.preview) && hasText(fileRecord.preview)) {
        existing.preview = fileRecord.preview;
    }
    candidateMap.set(fileRecord.path, existing);
}

function resolveReferencedPath(state: any, reference: string, basenameMap: Map<string, any[]>) {
    const normalizedReference = normalizeRepoPath(reference);
    const exactMatch = state.filesByPath.get(normalizedReference) ?? state.filesByPath.get(path.posix.normalize(normalizedReference));
    if(exactMatch?.indexed) {
        return exactMatch;
    }

    const basename = path.posix.basename(normalizedReference);
    const basenameMatches = basenameMap.get(basename) ?? [];
    if(basenameMatches.length === 1) {
        return basenameMatches[0];
    }

    return null;
}

function collectRelatedFiles(state: any, query: any, topChunks: any[], topFiles: any[]) {
    const topFilePaths = new Set(topFiles.map((file: any) => file.path));
    const relatedCandidates = new Map<string, any>();
    const indexedFileRecords = state.fileRecords.filter((fileRecord: any) => fileRecord.indexed);
    const basenameMap = new Map<string, any[]>();
    const stemMap = new Map<string, any[]>();
    const directoryMap = new Map<string, any[]>();
    const salientIdentifiers = new Set<string>();
    const salientTitleTokens = new Set<string>();

    for(const fileRecord of indexedFileRecords) {
        const basename = path.posix.basename(fileRecord.path);
        const stem = pathStem(fileRecord.path);
        const directory = path.posix.dirname(fileRecord.path);

        if(!basenameMap.has(basename)) {
            basenameMap.set(basename, []);
        }
        basenameMap.get(basename)!.push(fileRecord);

        if(!stemMap.has(stem)) {
            stemMap.set(stem, []);
        }
        stemMap.get(stem)!.push(fileRecord);

        if(!directoryMap.has(directory)) {
            directoryMap.set(directory, []);
        }
        directoryMap.get(directory)!.push(fileRecord);
    }

    for(const records of basenameMap.values()) {
        records.sort((left, right) => left.path.localeCompare(right.path));
    }
    for(const records of stemMap.values()) {
        records.sort((left, right) => left.path.localeCompare(right.path));
    }
    for(const records of directoryMap.values()) {
        records.sort((left, right) => left.path.localeCompare(right.path));
    }

    const referenceText = [
        ...topChunks.slice(0, 8).map((chunk: any) => [chunk.title, chunk.preview, chunk.text].filter(hasText).join('\n')),
        ...topFiles.slice(0, 4).map((file: any) => [file.preview].filter(hasText).join('\n')),
    ].join('\n');

    const referencedPaths = extractReferencedPaths(
        referenceText,
        new Set(indexedFileRecords.map((fileRecord: any) => path.posix.basename(fileRecord.path))),
    );

    for(const referencePath of referencedPaths) {
        const resolvedFile = resolveReferencedPath(state, referencePath, basenameMap);
        if(resolvedFile && !topFilePaths.has(resolvedFile.path)) {
            addRelatedCandidate(relatedCandidates, resolvedFile, `referenced path: ${referencePath}`, 100);
        }
    }

    for(const topFile of topFiles) {
        const topFileRecord = state.filesById.get(topFile.file_id);
        if(!topFileRecord) {
            continue;
        }

        const topStem = pathStem(topFileRecord.path);
        const pairedFiles = stemMap.get(topStem) ?? [];
        const topIsTestLike = isTestLikePath(topFileRecord.path, topFileRecord.file_class);

        for(const candidateFile of pairedFiles) {
            if(candidateFile.path === topFileRecord.path || topFilePaths.has(candidateFile.path)) {
                continue;
            }

            const candidateIsTestLike = isTestLikePath(candidateFile.path, candidateFile.file_class);
            if(candidateIsTestLike === topIsTestLike) {
                continue;
            }

            addRelatedCandidate(
                relatedCandidates,
                candidateFile,
                topIsTestLike ? 'paired source file' : 'paired test file',
                80,
            );
        }

        const topDirectory = path.posix.dirname(topFileRecord.path);
        const siblingFiles = directoryMap.get(topDirectory) ?? [];
        const topStemTokens = new Set(pathStemTokens(topFileRecord.path));

        for(const candidateFile of siblingFiles) {
            if(candidateFile.path === topFileRecord.path || topFilePaths.has(candidateFile.path)) {
                continue;
            }

            const candidateStemTokens = pathStemTokens(candidateFile.path);
            if(candidateStemTokens.some((token) => topStemTokens.has(token))) {
                addRelatedCandidate(relatedCandidates, candidateFile, 'same directory sibling', 40);
            }
        }

        for(const identifier of topFileRecord.top_identifiers ?? []) {
            salientIdentifiers.add(String(identifier.identifier ?? '').toLowerCase());
        }
        for(const sectionTitle of topFileRecord.section_titles ?? []) {
            for(const token of titleTokens(sectionTitle)) {
                salientTitleTokens.add(token);
            }
        }
    }

    for(const topChunk of topChunks) {
        for(const identifier of topChunk.top_identifiers ?? []) {
            salientIdentifiers.add(String(identifier.identifier ?? '').toLowerCase());
        }
        for(const token of titleTokens(topChunk.title || '')) {
            salientTitleTokens.add(token);
        }
    }

    for(const fileRecord of indexedFileRecords) {
        if(topFilePaths.has(fileRecord.path)) {
            continue;
        }

        const candidateIdentifiers = new Set<string>(
            (fileRecord.top_identifiers ?? [])
                .map((identifier: any) => String(identifier.identifier ?? '').toLowerCase())
                .filter((identifier: string) => identifier.length > 0),
        );
        const sharedIdentifier = [...candidateIdentifiers].find((identifier) => salientIdentifiers.has(identifier));
        if(sharedIdentifier) {
            addRelatedCandidate(relatedCandidates, fileRecord, `shared identifier: ${sharedIdentifier}`, 25);
            continue;
        }

        const candidateTitleTokens = new Set<string>();
        for(const title of fileRecord.section_titles ?? []) {
            for(const token of titleTokens(title)) {
                candidateTitleTokens.add(token);
            }
        }
        const sharedTitleToken = [...candidateTitleTokens].find((token) => salientTitleTokens.has(token));
        if(sharedTitleToken) {
            addRelatedCandidate(relatedCandidates, fileRecord, `shared title: ${sharedTitleToken}`, 15);
        }
    }

    return [...relatedCandidates.values()]
        .map((candidate: any) => ({
            path:      candidate.path,
            reason:    [...candidate.reasons].sort().join('; '),
            score:     candidate.score,
            preview:   candidate.preview,
            file_class: candidate.file_class,
        }))
        .sort((left: any, right: any) => right.score - left.score || left.path.localeCompare(right.path))
        .slice(0, 6);
}

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
        text:          chunkRecord.text,
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

    const relatedFiles = collectRelatedFiles(state, query, chunkScores.slice(0, 12), topFiles.slice(0, 8));

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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = safeSlug(queryText, 'query').slice(0, QUERY_ARTIFACT_SLUG_MAX_LENGTH).replace(/[-._]+$/g, '') || 'query';
    const fileName = `${timestamp}_${safeSlug(kind, 'query')}_${slug}.json`;
    await writeJson(path.join(paths.QUERIES_DIR, fileName), payload);
}

export function makePersistableQueryResult(result: any) {
    const payload: any = {
        query:        result.query,
        topFiles:     result.topFiles,
        topChunks:    result.topChunks,
        relatedFiles: result.relatedFiles,
    };

    if(result.command) {
        payload.command = result.command;
    }

    if(result.suggestedNextCommands) {
        payload.suggestedNextCommands = result.suggestedNextCommands;
    }

    return payload;
}
