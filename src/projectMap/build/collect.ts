import fs from 'node:fs/promises';
import path from 'path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { getPaths, PROJECT_MAP_VERSION, DEFAULT_BUILD_CONCURRENCY_LIMIT } from '../constants';
import { shouldIgnoreDirectory } from '../../ignore';
import { toRelativeProjectPath } from '../../utils';
import {
    ensureScaleDirectory,
    removeDirectoryIfPresent,
    ensureStateDirectories,
    writeJson,
    writeJsonLines
} from '../io';
import { isTextFile } from '../../isTextFile';
import { classifyFile } from '../../classifyFile';
import { chunkTextFile } from '../../chunkTextFile';
import { createPostingsAccumulator, addChunkToPostings, persistPostings } from './postings';
import {
    buildIndexedFileRecord,
    buildSkippedFileRecord,
    buildRepoTopTerms,
    buildDirectoryRecords
} from './records';
import { buildKnownBasenamesSet, incrementCounterObject, sortCounterObject } from './utils';

export async function collectProjectFiles(projectRoot?: string) {
    const {PROJECT_ROOT} = getPaths(projectRoot);
    const results: Array<{ absolute_path: string; relative_path: string }> = [];

    async function walk(absoluteDirectoryPath: string) {
        const entries = await fs.readdir(absoluteDirectoryPath, {withFileTypes: true});
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for(const entry of entries) {
            const absoluteEntryPath = path.join(absoluteDirectoryPath, entry.name);
            const relativeEntryPath = toRelativeProjectPath(absoluteEntryPath, PROJECT_ROOT);

            if(entry.isDirectory()) {
                if(shouldIgnoreDirectory(relativeEntryPath, entry.name)) {
                    continue;
                }

                await walk(absoluteEntryPath);
                continue;
            }

            if(!entry.isFile()) {
                continue;
            }

            results.push({absolute_path: absoluteEntryPath, relative_path: relativeEntryPath});
        }
    }

    await walk(PROJECT_ROOT);
    return results;
}

export async function runBuild(projectRoot?: string) {
    const paths = getPaths(projectRoot);
    const overallStart = performance.now();
    console.log('PROJECT MAP BUILD STARTED');
    console.log(`project_root: ${paths.PROJECT_ROOT}`);
    // ensure .ai/scale exists
    await ensureScaleDirectory(paths.AI_DIR);

    // Per the operating model: remove any existing state and create fresh dirs
    await removeDirectoryIfPresent(paths.STATE_DIR);
    await ensureStateDirectories(paths);

    const buildStartedAt = new Date().toISOString();
    console.log('discovering files...');
    const discoveryStart = performance.now();
    const discoveredFiles = await collectProjectFiles(projectRoot);
    const discoveryElapsed = performance.now() - discoveryStart;
    console.log(`discovered_files: ${discoveredFiles.length} (${discoveryElapsed.toFixed(1)} ms)`);
    const knownBasenamesSet = buildKnownBasenamesSet(discoveredFiles.map((file) => file.relative_path));

    const fileRecords: any[] = [];
    const chunkRecords: any[] = [];
    const postings = createPostingsAccumulator();

    let indexedTextFiles = 0;
    let skippedFiles = 0;
    let binaryFiles = 0;
    let generatedFiles = 0;
    let fileCounter = 0;
    let chunkCounter = 0;

    const nextFileId = () => {
        fileCounter += 1;
        return `f${String(fileCounter).padStart(6, '0')}`;
    };

    const nextChunkId = () => {
        chunkCounter += 1;
        return `c${String(chunkCounter).padStart(7, '0')}`;
    };

    // Small helper: map with a bounded concurrency level while preserving input order
    // - preserves result ordering (results[i] corresponds to items[i])
    // - limits number of concurrently-running workers
    // - rejects immediately if any worker rejects
    async function mapWithConcurrency<T, R>(
        items: T[],
        worker: (item: T, index: number) => Promise<R>,
        concurrency: number
    ): Promise<R[]> {
        const results: R[] = new Array(items.length);
        let nextIndex = 0;
        let active = 0;

        return await new Promise<R[]>((resolve, reject) => {
            function launch() {
                if (nextIndex >= items.length && active === 0) {
                    resolve(results);
                    return;
                }

                while (active < concurrency && nextIndex < items.length) {
                    const idx = nextIndex++;
                    active += 1;

                    Promise.resolve()
                        .then(() => worker(items[idx], idx))
                        .then((res) => {
                            results[idx] = res;
                            active -= 1;
                            launch();
                        })
                        .catch((err) => reject(err));
                }
            }

            launch();
        });
    }

    // Process files concurrently with local (per-file) chunk ids, but preserve
    // deterministic ordering by:
    // 1) assigning file ids in discovered-file order before launching work
    // 2) running per-file processing with bounded concurrency
    // 3) collecting results in input order and performing the final merge in that order
    const processedFiles: Array<{
        fileRecord: any;
        chunkRecords: any[];
        deltas: { indexedTextFiles: number; skippedFiles: number; binaryFiles: number; generatedFiles: number };
    }> = [];

    // Assign deterministic file ids in discovery order before doing any async work
    const fileIds = discoveredFiles.map(() => nextFileId());

    // Determine concurrency conservatively
    const available = typeof (os as any).availableParallelism === 'function'
        ? (os as any).availableParallelism()
        : os.cpus().length;
    const CONCURRENCY = Math.max(1, Math.min(DEFAULT_BUILD_CONCURRENCY_LIMIT, Number(available) || 1));

    const worker = (discoveredFile: { absolute_path: string; relative_path: string }, index: number) => {
        return processDiscoveredFileForBuild({
            discoveredFile,
            fileId: fileIds[index],
            knownBasenamesSet,
        });
    };

    console.log(`processing files: ${discoveredFiles.length} (concurrency=${CONCURRENCY})...`);
    const processingStart = performance.now();
    const results = await mapWithConcurrency(discoveredFiles, worker, CONCURRENCY);
    for (const r of results) processedFiles.push(r);

    // Aggregate counters deterministically in discovered-file order
    for (const processed of processedFiles) {
        indexedTextFiles += processed.deltas.indexedTextFiles;
        skippedFiles += processed.deltas.skippedFiles;
        binaryFiles += processed.deltas.binaryFiles;
        generatedFiles += processed.deltas.generatedFiles;
    }

    // Finalize chunk ids in strict discovery order. This is the only place that uses the
    // global nextChunkId generator; it ensures deterministic global chunk ids while allowing
    // per-file processing to have used private/local temporary ids.
    for(const processed of processedFiles) {
        // Map local -> final ids for this file
        const localToFinal: Record<string, string> = {};
        for(const chunk of processed.chunkRecords) {
            const finalId = nextChunkId();
            // record mapping and mutate the chunk record in-place
            localToFinal[chunk.chunk_id] = finalId;
            chunk.chunk_id = finalId;
            // push finalized chunk into global chunk list
            chunkRecords.push(chunk);
        }

        // Update fileRecord.chunk_ids to final ids (preserve order)
        if(processed.fileRecord && Array.isArray(processed.fileRecord.chunk_ids)) {
            processed.fileRecord = {
                ...processed.fileRecord,
                chunk_ids: processed.fileRecord.chunk_ids.map((id: string) => localToFinal[id] ?? id),
            };
        }

        // Now that chunks are finalized for this file, add them to postings and add fileRecord
        for(const chunk of processed.chunkRecords) {
            addChunkToPostings(postings, chunk);
        }

        fileRecords.push(processed.fileRecord);
    }

    const processingElapsed = performance.now() - processingStart;
    console.log(`processed files: indexed=${indexedTextFiles} skipped=${skippedFiles} chunks=${chunkRecords.length} (${processingElapsed.toFixed(1)} ms)`);

    const directoryRecords = buildDirectoryRecords(fileRecords);

    const extensionCounts: Record<string, number> = {};
    const classCounts: Record<string, number> = {};

    for(const fileRecord of fileRecords) {
        incrementCounterObject(extensionCounts, fileRecord.extension || '(none)');
        incrementCounterObject(classCounts, fileRecord.file_class);
    }

    const repoSynopsis = {
        project_root:               paths.PROJECT_ROOT,
        project_root_relative_hint: '.',
        built_at:                   new Date().toISOString(),
        version:                    PROJECT_MAP_VERSION,
        total_files_seen:           fileRecords.length,
        indexed_text_files:         indexedTextFiles,
        skipped_files:              skippedFiles,
        binary_files:               binaryFiles,
        generated_files_skipped:    generatedFiles,
        total_chunks:               chunkRecords.length,
        major_extensions:           sortCounterObject(extensionCounts, 20),
        major_file_classes:         sortCounterObject(classCounts, 20),
        top_terms:                  buildRepoTopTerms(fileRecords),
        largest_indexed_text_files: fileRecords
                                        .filter((fr) => fr.indexed)
                                        .sort((l, r) => r.size_bytes - l.size_bytes)
                                        .slice(0, 20)
                                        .map((fr) => ({
                                            path:        fr.path,
                                            size_bytes:  fr.size_bytes,
                                            chunk_count: fr.chunk_count,
                                            file_class:  fr.file_class
                                        })),
        major_directories:          directoryRecords
                                        .filter((d) => d.path !== '.')
                                        .sort((l, r) => r.recursive_file_count - l.recursive_file_count || l.path.localeCompare(r.path))
                                        .slice(0, 20)
                                        .map((d) => ({
                                            path:                 d.path,
                                            recursive_file_count: d.recursive_file_count,
                                            indexed_file_count:   d.indexed_file_count
                                        })),
    };

    const buildInfo = {
        version:            PROJECT_MAP_VERSION,
        build_started_at:   buildStartedAt,
        build_finished_at:  new Date().toISOString(),
        project_root:       paths.PROJECT_ROOT,
        total_files_seen:   fileRecords.length,
        indexed_text_files: indexedTextFiles,
        skipped_files:      skippedFiles,
        total_chunks:       chunkRecords.length,
    };

    // Persist core state
    console.log('writing state...');
    const writeStart = performance.now();
    await writeJson(path.join(paths.STATE_DIR, 'build.json'), buildInfo);
    await writeJson(path.join(paths.STATE_DIR, 'repo.json'), repoSynopsis);
    await writeJsonLines(path.join(paths.STATE_DIR, 'dirs.jsonl'), directoryRecords);
    await writeJsonLines(path.join(paths.STATE_DIR, 'files.jsonl'), fileRecords);
    await writeJsonLines(path.join(paths.STATE_DIR, 'chunks.jsonl'), chunkRecords);

    // Persist postings and synopses
    await persistPostings(postings, paths.POSTINGS_DIR);

    // repo-level and per-dir/file synopses
    await writeJson(path.join(paths.SYNOPSES_DIR, 'repo.json'), repoSynopsis);
    for(const directoryRecord of directoryRecords) {
        await writeJson(path.join(paths.SYNOPSES_DIRS_DIR, `${directoryRecord.dir_id}.json`), directoryRecord);
    }

    for(const fileRecord of fileRecords) {
        await writeJson(path.join(paths.SYNOPSES_FILES_DIR, `${fileRecord.file_id}.json`), fileRecord);
    }
    const writeElapsed = performance.now() - writeStart;
    console.log(`wrote state (${writeElapsed.toFixed(1)} ms)`);

    const totalElapsed = performance.now() - overallStart;
    printBuildSummary(buildInfo, repoSynopsis, totalElapsed);
    return {buildInfo, repoSynopsis, directoryRecords, fileRecords, chunkRecords};
}

/**
 * Result of processing a single discovered file during build.
 */
interface ProcessedBuildFile {
    fileRecord: any;
    chunkRecords: any[];
    deltas: {
        indexedTextFiles: number;
        skippedFiles: number;
        binaryFiles: number;
        generatedFiles: number;
    };
}

async function processDiscoveredFileForBuild(opts: {
    discoveredFile: { absolute_path: string; relative_path: string };
    fileId: string;
    knownBasenamesSet: Set<string>;
}): Promise<ProcessedBuildFile> {
    const {discoveredFile, fileId, knownBasenamesSet} = opts;
    const stats = await fs.stat(discoveredFile.absolute_path);
    const extension = path.extname(discoveredFile.relative_path).toLowerCase();
    const textFile = await isTextFile(discoveredFile.absolute_path, extension);
    const fileClass = classifyFile(discoveredFile.relative_path, extension, textFile);

    // default empty results
    const deltas = {indexedTextFiles: 0, skippedFiles: 0, binaryFiles: 0, generatedFiles: 0};
    let fileRecord: any = null;
    const chunkRecords: any[] = [];

    if(!textFile) {
        deltas.binaryFiles = 1;
        deltas.skippedFiles = 1;
        fileRecord = buildSkippedFileRecord({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            extension,
            sizeBytes:        stats.size,
            mtimeMs:          stats.mtimeMs,
            fileClass,
            skipReason:       'binary-or-asset',
        });
        return {fileRecord, chunkRecords, deltas};
    }

    if(fileClass === 'generated') {
        deltas.generatedFiles = 1;
        deltas.skippedFiles = 1;
        fileRecord = buildSkippedFileRecord({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            extension,
            sizeBytes:        stats.size,
            mtimeMs:          stats.mtimeMs,
            fileClass,
            skipReason:       'generated-noise',
        });
        return {fileRecord, chunkRecords, deltas};
    }

    const text = await fs.readFile(discoveredFile.absolute_path, 'utf8');
    // Use a local (per-file) temporary chunk id generator so per-file processing
    // doesn't rely on any shared global counter. These local ids will be
    // replaced later in runBuild(). The prefix 'local-c' is intentionally
    // distinct so tests can assert final ids don't contain it.
    let localChunkCounter = 0;
    const localChunkId = () => {
        localChunkCounter += 1;
        return `local-c${String(localChunkCounter).padStart(6, '0')}`;
    };

    const {lines, chunks} = chunkTextFile({
        fileId,
        relativeFilePath: discoveredFile.relative_path,
        text,
        knownBasenamesSet,
        chunkIdGenerator: localChunkId,
    });

    for(const chunk of chunks) {
        chunkRecords.push(chunk);
    }

    fileRecord = buildIndexedFileRecord({
        fileId,
        relativeFilePath: discoveredFile.relative_path,
        extension,
        sizeBytes:        stats.size,
        mtimeMs:          stats.mtimeMs,
        fileClass,
        text,
        lines,
        chunks,
    });

    deltas.indexedTextFiles = 1;
    return {fileRecord, chunkRecords, deltas};
}

function printBuildSummary(buildInfo: any, repoSynopsis: any, totalMs?: number) {
    console.log('PROJECT MAP BUILD COMPLETE');
    if (typeof totalMs === 'number') {
        console.log(`total_time: ${(totalMs/1000).toFixed(2)}s (${totalMs.toFixed(1)} ms)`);
    }
    console.log(`version: ${buildInfo.version}`);
    console.log(`project_root: ${buildInfo.project_root}`);
    console.log(`built_at: ${buildInfo.build_finished_at}`);
    console.log(`total_files_seen: ${buildInfo.total_files_seen}`);
    console.log(`indexed_text_files: ${buildInfo.indexed_text_files}`);
    console.log(`skipped_files: ${buildInfo.skipped_files}`);
    console.log(`total_chunks: ${buildInfo.total_chunks}`);
    console.log('');
    console.log('TOP DIRECTORIES');

    for(const directory of repoSynopsis.major_directories.slice(0, 10)) {
        console.log(`- ${directory.path} (files=${directory.recursive_file_count}, indexed=${directory.indexed_file_count})`);
    }
}

