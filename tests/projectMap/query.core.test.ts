import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const mocks = vi.hoisted(() => {
    const getPaths = vi.fn();
    const readJson = vi.fn();
    const writeJson = vi.fn();
    const loadCoreState = vi.fn();

    return {
        getPaths,
        readJson,
        writeJson,
        loadCoreState,
    };
});

vi.mock('../../src/projectMap/constants', () => ({
    getPaths: mocks.getPaths,
}));

vi.mock('../../src/projectMap/io', () => ({
    readJson: mocks.readJson,
    writeJson: mocks.writeJson,
}));

vi.mock('../../src/projectMap/state', () => ({
    loadCoreState: mocks.loadCoreState,
}));

import {
    loadRelevantPostings,
    makePersistableQueryResult,
    normalizeQuery,
    persistQueryArtifact,
    runQuery,
    scoreChunkForQuery,
} from '../../src/projectMap/query/core';

function makePaths(projectRoot: string) {
    const stateDir = path.join(projectRoot, '.ai', 'scale', 'state');
    return {
        PROJECT_ROOT: projectRoot,
        AI_DIR: path.join(projectRoot, '.ai'),
        SCALE_DIR: path.join(projectRoot, '.ai', 'scale'),
        STATE_DIR: stateDir,
        POSTINGS_DIR: path.join(stateDir, 'postings'),
        SYNOPSES_DIR: path.join(stateDir, 'synopses'),
        SYNOPSES_DIRS_DIR: path.join(stateDir, 'synopses', 'dirs'),
        SYNOPSES_FILES_DIR: path.join(stateDir, 'synopses', 'files'),
        QUERIES_DIR: path.join(stateDir, 'queries'),
    };
}

function makeState() {
    const matchingFile = {
        file_id: 'f0001',
        path: 'src/example.ts',
        file_class: 'source',
        indexed: true,
        extension: '.ts',
        size_bytes: 123,
        line_count: 10,
        chunk_count: 1,
        preview: 'file preview',
    };
    const unindexedFile = {
        file_id: 'f0002',
        path: 'src/unindexed.ts',
        file_class: 'source',
        indexed: false,
        extension: '.ts',
        size_bytes: 55,
        line_count: 5,
        chunk_count: 1,
        preview: '',
    };
    const matchingChunk = {
        chunk_id: 'c0001',
        file_id: 'f0001',
        path: 'src/example.ts',
        start_line: 1,
        end_line: 10,
        kind: 'body',
        title: 'Alpha Section',
        preview: 'chunk preview',
        text: 'alpha beta exact phrase',
        line_count: 2,
        top_identifiers: [{identifier: 'beta', count: 1}],
        top_terms: [{term: 'alpha', count: 1}],
    };
    const unindexedChunk = {
        chunk_id: 'c0002',
        file_id: 'f0002',
        path: 'src/unindexed.ts',
        start_line: 1,
        end_line: 5,
        kind: 'body',
        title: 'Beta Section',
        preview: 'unindexed chunk',
        text: 'beta only',
        line_count: 1,
        top_identifiers: [],
        top_terms: [],
    };
    const missingFileChunk = {
        chunk_id: 'c0003',
        file_id: 'f0003',
        path: 'src/missing.ts',
        start_line: 1,
        end_line: 5,
        kind: 'body',
        title: 'Missing',
        preview: 'missing chunk',
        text: 'missing',
        line_count: 1,
        top_identifiers: [],
        top_terms: [],
    };

    return {
        state: {
            filesById: new Map([
                [matchingFile.file_id, matchingFile],
                [unindexedFile.file_id, unindexedFile],
            ]),
            filesByPath: new Map([
                [matchingFile.path, matchingFile],
                [unindexedFile.path, unindexedFile],
            ]),
            chunksById: new Map([
                [matchingChunk.chunk_id, matchingChunk],
                [unindexedChunk.chunk_id, unindexedChunk],
                [missingFileChunk.chunk_id, missingFileChunk],
            ]),
            chunksByFileId: new Map([
                [matchingFile.file_id, [matchingChunk]],
                [unindexedFile.file_id, [unindexedChunk]],
            ]),
        },
        matchingFile,
        unindexedFile,
        matchingChunk,
        unindexedChunk,
        missingFileChunk,
    };
}

describe('query core', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('normalizes queries and dedupes terms', () => {
        expect(normalizeQuery('  Find \n  This   Query query  ')).toEqual({
            original: '  Find \n  This   Query query  ',
            normalized_text: 'Find This Query query',
            terms: ['find', 'this', 'query'],
        });
    });

    it('scores chunks with the major match boosts', () => {
        const query = {
            original: 'alpha beta test',
            normalized_text: 'alpha beta',
            terms: ['alpha', 'beta', 'test'],
        };
        const chunkRecord = {
            chunk_id: 'c0001',
            text: 'alpha beta exact phrase',
            title: 'Alpha heading',
            kind: 'body',
            start_line: 1,
            end_line: 2,
            preview: 'chunk preview',
            line_count: 2,
            top_identifiers: [{identifier: 'beta'}],
        };
        const fileRecord = {
            file_id: 'f0001',
            path: 'src/alpha-beta-test.ts',
            file_class: 'test',
        };
        const postingsByTerm = new Map([
            ['alpha', [{chunk_id: 'c0001', tf: 2}]],
            ['beta', [{chunk_id: 'c0001', tf: 1}]],
            ['test', [{chunk_id: 'c0001', tf: 1}]],
        ]);

        const scored = scoreChunkForQuery({chunkRecord, fileRecord, query, postingsByTerm});

        expect(scored.matched_terms).toEqual(['alpha', 'beta', 'test']);
        expect(scored.reasons).toEqual(expect.arrayContaining([
            'matched 3 query term(s)',
            'exact phrase match',
            'title/section match',
            'path match',
            'all query terms present',
            'identifier match',
            'test-class boost',
        ]));
        expect(scored.score).toBeGreaterThan(30);
    });

    it('scores doc and config classes through their dedicated boosts', () => {
        const docQuery = {original: 'guide room', normalized_text: 'guide room', terms: ['guide', 'room']};
        const configQuery = {original: 'yaml config', normalized_text: 'yaml config', terms: ['yaml', 'config']};
        const baseChunk = {
            chunk_id: 'c0001',
            text: 'guide room yaml config',
            title: '',
            kind: 'body',
            start_line: 1,
            end_line: 2,
            preview: '',
            line_count: 1,
            top_identifiers: [],
        };
        const postingsByTerm = new Map([
            ['guide', [{chunk_id: 'c0001', tf: 1}]],
            ['room', [{chunk_id: 'c0001', tf: 1}]],
            ['yaml', [{chunk_id: 'c0001', tf: 1}]],
            ['config', [{chunk_id: 'c0001', tf: 1}]],
        ]);

        expect(scoreChunkForQuery({
            chunkRecord: baseChunk,
            fileRecord: {file_id: 'f0001', path: 'docs/manual.md', file_class: 'doc'},
            query: docQuery,
            postingsByTerm,
        }).reasons).toContain('doc-class boost');

        expect(scoreChunkForQuery({
            chunkRecord: baseChunk,
            fileRecord: {file_id: 'f0001', path: 'config/app.yaml', file_class: 'config'},
            query: configQuery,
            postingsByTerm,
        }).reasons).toContain('config-class boost');
    });

    it('loads relevant postings from the expected buckets and ignores missing buckets', async () => {
        const projectRoot = path.join('C:\\', 'project-mapper-test');
        mocks.getPaths.mockReturnValue(makePaths(projectRoot));
        mocks.readJson.mockImplementation(async (filePath: string) => {
            if(filePath.endsWith(path.join('postings', 'a.json'))) {
                return {alpha: [{chunk_id: 'c0001', tf: 1}]};
            }
            if(filePath.endsWith(path.join('postings', 'num.json'))) {
                throw new Error('missing bucket');
            }
            if(filePath.endsWith(path.join('postings', 'other.json'))) {
                return {__other: [{chunk_id: 'c0002', tf: 2}]};
            }
            return {};
        });

        const postings = await loadRelevantPostings(['alpha', '2cool', '!bang'], projectRoot);

        expect(mocks.getPaths).toHaveBeenCalledWith(projectRoot);
        expect(mocks.readJson).toHaveBeenCalledTimes(3);
        expect(postings.get('alpha')).toEqual([{chunk_id: 'c0001', tf: 1}]);
        expect(postings.get('__other')).toEqual([{chunk_id: 'c0002', tf: 2}]);
    });

    it('runs queries, skips invalid candidates, and aggregates file results', async () => {
        const projectRoot = path.join('C:\\', 'project-mapper-test');
        const {state, matchingChunk} = makeState();
        mocks.loadCoreState.mockResolvedValue(state);
        mocks.getPaths.mockReturnValue(makePaths(projectRoot));
        mocks.readJson.mockImplementation(async (filePath: string) => {
            if(filePath.endsWith(path.join('postings', 'a.json'))) {
                return {
                    alpha: [
                        {chunk_id: 'c0001', tf: 2},
                        {chunk_id: 'c0002', tf: 1},
                        {chunk_id: 'c0003', tf: 1},
                    ],
                    beta: [{chunk_id: 'c0001', tf: 1}],
                };
            }
            return {};
        });

        const result = await runQuery('alpha beta', projectRoot);

        expect(result.query.terms).toEqual(['alpha', 'beta']);
        expect(result.topChunks).toHaveLength(1);
        expect(result.topChunks[0].chunk_id).toBe('c0001');
        expect(result.topFiles).toHaveLength(1);
        expect(result.topFiles[0].file_id).toBe('f0001');
        expect(result.topFiles[0].best_chunks[0].chunk_id).toBe(matchingChunk.chunk_id);
        expect(result.relatedFiles).toEqual([]);
    });

    it('returns empty query results without loading postings', async () => {
        const projectRoot = path.join('C:\\', 'project-mapper-test');
        mocks.loadCoreState.mockResolvedValue({
            filesById: new Map(),
            filesByPath: new Map(),
            chunksById: new Map(),
            chunksByFileId: new Map(),
        });

        const result = await runQuery('   ', projectRoot);

        expect(result.topChunks).toEqual([]);
        expect(result.topFiles).toEqual([]);
        expect(result.relatedFiles).toEqual([]);
        expect(mocks.readJson).not.toHaveBeenCalled();
    });

    it('persists query artifacts with bounded slugs', async () => {
        const projectRoot = path.join('C:\\', 'project-mapper-test');
        mocks.getPaths.mockReturnValue(makePaths(projectRoot));
        mocks.writeJson.mockResolvedValue(undefined);

        const longQuery = 'Find THIS! Query / with "quotes", symbols #$%, whitespace   , and a very long tail to keep the slug bounded '.repeat(3);

        await persistQueryArtifact('pack', longQuery, {ok: true}, projectRoot);

        expect(mocks.writeJson).toHaveBeenCalledTimes(1);
        const [writtenPath, payload] = mocks.writeJson.mock.calls[0];
        expect(writtenPath).toContain(path.join('.ai', 'scale', 'state', 'queries'));
        expect(path.basename(writtenPath)).toMatch(/_pack_/);
        expect(path.basename(writtenPath)).toMatch(/\.json$/);
        expect(path.basename(writtenPath).length).toBeLessThanOrEqual(140);
        expect(payload).toEqual({ok: true});
    });

    it('builds persistable query results without changing shape', () => {
        const result = makePersistableQueryResult({
            query: {original: 'x'},
            topFiles: [{path: 'a'}],
            topChunks: [{chunk_id: 'c'}],
            relatedFiles: [{path: 'b'}],
            extra: true,
        });

        expect(result).toEqual({
            query: {original: 'x'},
            topFiles: [{path: 'a'}],
            topChunks: [{chunk_id: 'c'}],
            relatedFiles: [{path: 'b'}],
        });
    });
});
