import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const loadCoreState = vi.fn();
    const runQuery = vi.fn();
    const persistQueryArtifact = vi.fn();
    const makePersistableQueryResult = vi.fn((result) => result);

    return {
        loadCoreState,
        runQuery,
        persistQueryArtifact,
        makePersistableQueryResult,
    };
});

vi.mock('../../src/projectMap/state', () => ({
    loadCoreState: mocks.loadCoreState,
}));

vi.mock('../../src/projectMap/query/core', () => ({
    runQuery: mocks.runQuery,
    persistQueryArtifact: mocks.persistQueryArtifact,
    makePersistableQueryResult: mocks.makePersistableQueryResult,
}));

import { runFind, runInspect, runPack, runStats } from '../../src/projectMap/commands';

function makeState() {
    const fileRecord = {
        file_id: 'f0001',
        path: 'src/example.ts',
        file_class: 'source',
        indexed: true,
        extension: '.ts',
        size_bytes: 123,
        line_count: 20,
        chunk_count: 1,
        preview: 'file preview',
        section_titles: ['Example'],
        top_terms: [{term: 'example', count: 2}],
        top_identifiers: [{identifier: 'ExampleId', count: 1}],
    };

    const chunkRecord = {
        chunk_id: 'c0001',
        file_id: 'f0001',
        path: 'src/example.ts',
        start_line: 1,
        end_line: 20,
        kind: 'body',
        title: 'Example chunk',
        preview: 'chunk preview',
        text: 'chunk text',
        top_terms: [{term: 'chunk', count: 1}],
        top_identifiers: [{identifier: 'ChunkId', count: 1}],
    };

    return {
        state: {
            filesById: new Map([[fileRecord.file_id, fileRecord]]),
            filesByPath: new Map([[fileRecord.path, fileRecord]]),
            chunksById: new Map([[chunkRecord.chunk_id, chunkRecord]]),
            chunksByFileId: new Map([[fileRecord.file_id, [chunkRecord]]]),
        },
        fileRecord,
        chunkRecord,
    };
}

function makeStatsState() {
    return {
        buildInfo: {version: '1.2.3'},
        repoInfo: {
            project_root: 'C:\\repo',
            built_at: '2026-04-16T00:00:00Z',
            total_files_seen: 10,
            indexed_text_files: 8,
            skipped_files: 1,
            binary_files: 1,
            generated_files_skipped: 0,
            total_chunks: 42,
            major_extensions: {'.ts': 6, '.md': 2},
            major_file_classes: {source: 7, doc: 1},
            major_directories: [
                {path: 'src', recursive_file_count: 7, indexed_file_count: 6},
                {path: 'docs', recursive_file_count: 1, indexed_file_count: 1},
            ],
        },
    };
}

describe('command persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps find and pack persistence wired up', async () => {
        const result = {
            query: {original: 'Find me', normalized_text: 'find me', terms: ['find', 'me']},
            topFiles: [{path: 'src/example.ts', score: 10, file_class: 'source', reasons: ['match'], preview: 'file preview', best_chunks: []}],
            topChunks: [{chunk_id: 'c0001', path: 'src/example.ts', start_line: 1, end_line: 20, title: 'Example chunk', score: 7, reasons: ['match'], preview: 'chunk preview'}],
            relatedFiles: [{path: 'src/related.ts', reason: 'neighbor'}],
        };

        mocks.loadCoreState.mockResolvedValue({});
        mocks.runQuery.mockResolvedValue(result);
        mocks.persistQueryArtifact.mockResolvedValue(undefined);

        await expect(runFind('Find me', '/tmp/project')).resolves.toBeUndefined();
        await expect(runPack('Find me', '/tmp/project')).resolves.toBeUndefined();

        expect(mocks.persistQueryArtifact).toHaveBeenNthCalledWith(1, 'find', 'Find me', result, '/tmp/project');
        expect(mocks.persistQueryArtifact).toHaveBeenNthCalledWith(2, 'pack', 'Find me', result, '/tmp/project');
    });

    it('prints stats and resolves successfully', async () => {
        mocks.loadCoreState.mockResolvedValue(makeStatsState());

        await expect(runStats('/tmp/project')).resolves.toBeUndefined();

        expect(console.log).toHaveBeenCalledWith('PROJECT MAP STATS');
        expect(console.log).toHaveBeenCalledWith('MAJOR EXTENSIONS');
        expect(console.log).toHaveBeenCalledWith('MAJOR FILE CLASSES');
        expect(console.log).toHaveBeenCalledWith('MAJOR DIRECTORIES');
    });

    it('persists inspect artifacts for chunk and file targets', async () => {
        const {state, fileRecord, chunkRecord} = makeState();

        mocks.loadCoreState.mockResolvedValue(state);
        mocks.persistQueryArtifact.mockResolvedValue(undefined);

        await expect(runInspect('c0001', '/tmp/project')).resolves.toBeUndefined();
        await expect(runInspect('src/example.ts', '/tmp/project')).resolves.toBeUndefined();

        expect(mocks.persistQueryArtifact).toHaveBeenNthCalledWith(
            1,
            'inspect',
            'c0001',
            expect.objectContaining({
                target: 'c0001',
                target_type: 'chunk',
                resolved_by: 'chunk_id',
                chunk: chunkRecord,
                owning_file: fileRecord,
            }),
            '/tmp/project',
        );

        expect(mocks.persistQueryArtifact).toHaveBeenNthCalledWith(
            2,
            'inspect',
            'src/example.ts',
            expect.objectContaining({
                target: 'src/example.ts',
                target_type: 'file',
                resolved_by: 'file_path',
                file: fileRecord,
                chunks: [chunkRecord],
            }),
            '/tmp/project',
        );
    });

    it('covers inspect file-id resolution and empty section/chunk branches', async () => {
        const fileRecord = {
            file_id: 'f0003',
            path: 'docs/guide.md',
            file_class: 'doc',
            indexed: false,
            extension: '.md',
            size_bytes: 999,
            line_count: 0,
            chunk_count: 0,
            preview: '',
            skip_reason: 'ignored for test',
            section_titles: [],
            top_terms: [],
            top_identifiers: [],
        };

        mocks.loadCoreState.mockResolvedValue({
            filesById: new Map([[fileRecord.file_id, fileRecord]]),
            filesByPath: new Map([[fileRecord.path, fileRecord]]),
            chunksById: new Map(),
            chunksByFileId: new Map([[fileRecord.file_id, []]]),
        });
        mocks.persistQueryArtifact.mockResolvedValue(undefined);

        await expect(runInspect('f0003', '/tmp/project')).resolves.toBeUndefined();

        expect(mocks.persistQueryArtifact).toHaveBeenCalledWith(
            'inspect',
            'f0003',
            expect.objectContaining({
                target: 'f0003',
                target_type: 'file',
                resolved_by: 'file_id',
                file: fileRecord,
                chunks: [],
            }),
            '/tmp/project',
        );
        expect(console.log).toHaveBeenCalledWith('skip_reason: ignored for test');
        expect(console.log).toHaveBeenCalledWith('- None.');
    });

    it('throws for unknown inspect targets', async () => {
        mocks.loadCoreState.mockResolvedValue({
            filesById: new Map(),
            filesByPath: new Map(),
            chunksById: new Map(),
            chunksByFileId: new Map(),
        });

        await expect(runInspect('missing', '/tmp/project')).rejects.toThrow('No file or chunk found for inspect target: missing');
    });

    it('warns instead of failing when persistence throws after output is produced', async () => {
        mocks.loadCoreState.mockResolvedValue({});
        mocks.runQuery.mockResolvedValue({
            query: {original: 'Find me', normalized_text: 'find me', terms: ['find', 'me']},
            topFiles: [],
            topChunks: [],
            relatedFiles: [],
        });
        mocks.persistQueryArtifact.mockRejectedValue(new Error('disk full'));

        await expect(runFind('Find me', '/tmp/project')).resolves.toBeUndefined();
        await expect(runPack('Find me', '/tmp/project')).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WARN: could not persist find artifact: disk full'));
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WARN: could not persist pack artifact: disk full'));
    });

    it('prints pack suggestions when results are available', async () => {
        const result = {
            query: {original: 'Find me', normalized_text: 'find me', terms: ['find', 'me']},
            topFiles: [
                {
                    path: 'src/example.ts',
                    score: 10,
                    file_class: 'source',
                    reasons: ['match'],
                    preview: 'file preview',
                    best_chunks: [{start_line: 1, end_line: 20, title: 'Example chunk'}],
                },
                {
                    path: 'src/other.ts',
                    score: 7,
                    file_class: 'source',
                    reasons: ['match'],
                    preview: 'other preview',
                    best_chunks: [{start_line: 3, end_line: 9, title: ''}],
                },
            ],
            topChunks: [
                {chunk_id: 'c0001', path: 'src/example.ts', start_line: 1, end_line: 20, title: 'Example chunk', score: 7, reasons: ['match'], preview: 'chunk preview'},
            ],
            relatedFiles: [{path: 'src/related.ts', reason: 'neighbor'}],
        };

        mocks.runQuery.mockResolvedValue(result);
        mocks.persistQueryArtifact.mockResolvedValue(undefined);

        await expect(runPack('Find me', '/tmp/project')).resolves.toBeUndefined();

        expect(console.log).toHaveBeenCalledWith('SUGGESTED NEXT COMMANDS');
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('inspect'));
    });
});
