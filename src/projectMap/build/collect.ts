import fs from 'node:fs/promises';
import path from 'path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { getPaths, PROJECT_MAP_VERSION, DEFAULT_BUILD_CONCURRENCY_LIMIT, DEFAULT_MAX_INDEXABLE_LINE_LENGTH } from '../constants';
import { shouldIgnoreDirectory } from '../../ignore';
import { toRelativeProjectPath, hasLineLongerThan } from '../../utils';
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
    console.log('preparing state...');
    const setupStart = performance.now();
    await ensureScaleDirectory(paths.AI_DIR);

    // Per the operating model: remove any existing state and create fresh dirs
    await removeDirectoryIfPresent(paths.STATE_DIR);
    await ensureStateDirectories(paths);
    const setupElapsed = performance.now() - setupStart;
    console.log(`prepared state (${setupElapsed.toFixed(1)} ms)`);

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
        timings: {
            metadataMs: number;
            readMs: number;
            chunkMs: number;
            recordMs: number;
            path: string;
            sizeBytes: number;
            indexed: boolean;
            fileClass: string;
            chunkCount: number;
            totalMs: number;
        };
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

    // 1) Per-file work: mapWithConcurrency over discovered files
    const fileProcessingStart = performance.now();
    const results = await mapWithConcurrency(discoveredFiles, worker, CONCURRENCY);
    for (const r of results) processedFiles.push(r);
    const fileProcessingElapsed = performance.now() - fileProcessingStart;
    console.log(`file processing work: ${fileProcessingElapsed.toFixed(1)} ms`);

    // Aggregate worker timings from per-file results (console-only)
    const workerTotals = processedFiles.reduce((acc, pf) => {
        const t = pf.timings || {metadataMs: 0, readMs: 0, chunkMs: 0, recordMs: 0, path: '', sizeBytes: 0, indexed: false, fileClass: '', chunkCount: 0, totalMs: 0};
        acc.metadataMs += t.metadataMs;
        acc.readMs += t.readMs;
        acc.chunkMs += t.chunkMs;
        acc.recordMs += t.recordMs;
        return acc;
    }, {metadataMs: 0, readMs: 0, chunkMs: 0, recordMs: 0});

    console.log(`file worker totals: metadata=${workerTotals.metadataMs.toFixed(1)} ms read=${workerTotals.readMs.toFixed(1)} ms chunk=${workerTotals.chunkMs.toFixed(1)} ms record=${workerTotals.recordMs.toFixed(1)} ms`);

    // Console-only: print top slow files by chunking and by total worker time.
    const TOP_SLOW_FILE_DIAGNOSTIC_LIMIT = 20;

    const diagnostics = processedFiles.map((pf) => pf.timings);

    // Chunking sorted: chunkMs desc, totalMs desc, path asc
    const chunkingTop = diagnostics
        .map((t) => ({
            path: String(t.path || ''),
            sizeBytes: Number(t.sizeBytes || 0),
            indexed: Boolean(t.indexed),
            fileClass: String(t.fileClass || ''),
            chunkCount: Number(t.chunkCount || 0),
            metadataMs: Number(t.metadataMs || 0),
            readMs: Number(t.readMs || 0),
            chunkMs: Number(t.chunkMs || 0),
            recordMs: Number(t.recordMs || 0),
            totalMs: Number(t.totalMs || 0),
        }))
        .sort((a, b) => {
            const d = b.chunkMs - a.chunkMs;
            if (d !== 0) return d;
            const d2 = b.totalMs - a.totalMs;
            if (d2 !== 0) return d2;
            return a.path.localeCompare(b.path);
        })
        .slice(0, TOP_SLOW_FILE_DIAGNOSTIC_LIMIT);

    if (chunkingTop.length > 0) {
        console.log('TOP SLOW FILES BY CHUNKING');
        for (const entry of chunkingTop) {
            console.log(`- ${entry.chunkMs.toFixed(1)} ms chunk | ${entry.chunkCount} chunks | ${entry.sizeBytes} bytes | ${entry.path}`);
        }
    }

    // Worker-time sorted: totalMs desc, chunkMs desc, path asc
    const workerTop = diagnostics
        .map((t) => ({
            path: String(t.path || ''),
            sizeBytes: Number(t.sizeBytes || 0),
            indexed: Boolean(t.indexed),
            fileClass: String(t.fileClass || ''),
            chunkCount: Number(t.chunkCount || 0),
            metadataMs: Number(t.metadataMs || 0),
            readMs: Number(t.readMs || 0),
            chunkMs: Number(t.chunkMs || 0),
            recordMs: Number(t.recordMs || 0),
            totalMs: Number(t.totalMs || 0),
        }))
        .sort((a, b) => {
            const d = b.totalMs - a.totalMs;
            if (d !== 0) return d;
            const d2 = b.chunkMs - a.chunkMs;
            if (d2 !== 0) return d2;
            return a.path.localeCompare(b.path);
        })
        .slice(0, TOP_SLOW_FILE_DIAGNOSTIC_LIMIT);

    if (workerTop.length > 0) {
        console.log('TOP SLOW FILES BY WORKER TIME');
        for (const entry of workerTop) {
            console.log(`- ${entry.totalMs.toFixed(1)} ms total | metadata=${entry.metadataMs.toFixed(1)} read=${entry.readMs.toFixed(1)} chunk=${entry.chunkMs.toFixed(1)} record=${entry.recordMs.toFixed(1)} ms | ${entry.chunkCount} chunks | ${entry.sizeBytes} bytes | ${entry.path}`);
        }
    }

    // 2) Ordered merge/finalization: deterministic aggregation, final chunk id assignment and postings
    const mergeStart = performance.now();

    // Subphase 1: aggregate counters deterministically in discovered-file order
    const counterAggStart = performance.now();
    for (const processed of processedFiles) {
        indexedTextFiles += processed.deltas.indexedTextFiles;
        skippedFiles += processed.deltas.skippedFiles;
        binaryFiles += processed.deltas.binaryFiles;
        generatedFiles += processed.deltas.generatedFiles;
    }
    const counterAggElapsed = performance.now() - counterAggStart;
    console.log(`counter aggregation work: ${counterAggElapsed.toFixed(1)} ms`);

    // Subphase 2: finalize chunk ids in strict discovery order. This is the only place that uses the
    // global nextChunkId generator; it ensures deterministic global chunk ids while allowing
    // per-file processing to have used private/local temporary ids.
    const chunkFinalizeStart = performance.now();
    for (const processed of processedFiles) {
        // Map local -> final ids for this file
        const localToFinal: Record<string, string> = {};
        for (const chunk of processed.chunkRecords) {
            const finalId = nextChunkId();
            // record mapping and mutate the chunk record in-place
            localToFinal[chunk.chunk_id] = finalId;
            chunk.chunk_id = finalId;
            // push finalized chunk into global chunk list
            chunkRecords.push(chunk);
        }

        // Update fileRecord.chunk_ids to final ids (preserve order)
        if (processed.fileRecord && Array.isArray(processed.fileRecord.chunk_ids)) {
            processed.fileRecord = {
                ...processed.fileRecord,
                chunk_ids: processed.fileRecord.chunk_ids.map((id: string) => localToFinal[id] ?? id),
            };
        }

        // Defer postings accumulation until all chunks have been finalized to allow a clean,
        // separately timed pass over finalized chunks.
        // Keep pushing fileRecords in discovery order to preserve final file ordering.
        fileRecords.push(processed.fileRecord);
    }
    const chunkFinalizeElapsed = performance.now() - chunkFinalizeStart;
    console.log(`chunk finalization work: ${chunkFinalizeElapsed.toFixed(1)} ms`);

    // Subphase 3: add finalized chunks to postings in final chunk order
    const postingsAccumStart = performance.now();
    for (const chunk of chunkRecords) {
        addChunkToPostings(postings, chunk);
    }
    const postingsAccumElapsed = performance.now() - postingsAccumStart;
    console.log(`postings accumulation work: ${postingsAccumElapsed.toFixed(1)} ms`);

    const mergeElapsed = performance.now() - mergeStart;
    console.log(`merge/postings work: ${mergeElapsed.toFixed(1)} ms`);

    // 3) Summary construction: directory records, extension/class counts, repo synopsis and build info
    const summaryStart = performance.now();
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

    const summaryElapsed = performance.now() - summaryStart;
    console.log(`summary work: ${summaryElapsed.toFixed(1)} ms`);

    const processingElapsed = fileProcessingElapsed + mergeElapsed + summaryElapsed;
    console.log(`processed files: indexed=${indexedTextFiles} skipped=${skippedFiles} chunks=${chunkRecords.length} (${processingElapsed.toFixed(1)} ms)`);

    // Persist core state with subphase timings
    console.log('writing state...');
    const writeStart = performance.now();

    const coreStart = performance.now();
    await writeJson(path.join(paths.STATE_DIR, 'build.json'), buildInfo);
    await writeJson(path.join(paths.STATE_DIR, 'repo.json'), repoSynopsis);
    await writeJsonLines(path.join(paths.STATE_DIR, 'dirs.jsonl'), directoryRecords);
    await writeJsonLines(path.join(paths.STATE_DIR, 'files.jsonl'), fileRecords);
    await writeJsonLines(path.join(paths.STATE_DIR, 'chunks.jsonl'), chunkRecords);
    const coreElapsed = performance.now() - coreStart;
    console.log(`core state write: ${coreElapsed.toFixed(1)} ms`);

    // Persist postings
    const postingsStart = performance.now();
    await persistPostings(postings, paths.POSTINGS_DIR);
    const postingsElapsed = performance.now() - postingsStart;
    console.log(`postings write: ${postingsElapsed.toFixed(1)} ms`);

    // repo-level and per-dir/file synopses
    const synopsisStart = performance.now();
    await writeJson(path.join(paths.SYNOPSES_DIR, 'repo.json'), repoSynopsis);
    // Write per-directory synopses with bounded concurrency - these writes are
    // independent and safe to parallelize. Use the local mapWithConcurrency
    // helper and the previously computed CONCURRENCY value.
    await mapWithConcurrency(directoryRecords, async (directoryRecord) => {
        return writeJson(path.join(paths.SYNOPSES_DIRS_DIR, `${directoryRecord.dir_id}.json`), directoryRecord);
    }, CONCURRENCY);

    // Write per-file synopses with bounded concurrency as well.
    await mapWithConcurrency(fileRecords, async (fileRecord) => {
        return writeJson(path.join(paths.SYNOPSES_FILES_DIR, `${fileRecord.file_id}.json`), fileRecord);
    }, CONCURRENCY);
    const synopsisElapsed = performance.now() - synopsisStart;
    console.log(`synopsis write: ${synopsisElapsed.toFixed(1)} ms`);

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
    // Console-only aggregated timing + non-persisted diagnostics for per-file worker phases.
    // These fields are intentionally NOT written into persisted file or chunk records.
    timings: {
        // per-phase timings
        metadataMs: number;
        readMs: number;
        chunkMs: number;
        recordMs: number;
        // diagnostics
        path: string;
        sizeBytes: number;
        indexed: boolean;
        fileClass: string;
        chunkCount: number;
        // convenience
        totalMs: number;
    };
}

async function processDiscoveredFileForBuild(opts: {
    discoveredFile: { absolute_path: string; relative_path: string };
    fileId: string;
    knownBasenamesSet: Set<string>;
}): Promise<ProcessedBuildFile> {
    const {discoveredFile, fileId, knownBasenamesSet} = opts;
    const metaStart = performance.now();
    const stats = await fs.stat(discoveredFile.absolute_path);
    const extension = path.extname(discoveredFile.relative_path).toLowerCase();
    const textFile = await isTextFile(discoveredFile.absolute_path, extension);
    const fileClass = classifyFile(discoveredFile.relative_path, extension, textFile);
    const metadataMs = performance.now() - metaStart;

    // default empty results
    const deltas = {indexedTextFiles: 0, skippedFiles: 0, binaryFiles: 0, generatedFiles: 0};
    let fileRecord: any = null;
    const chunkRecords: any[] = [];
    let readMs = 0;
    let chunkMs = 0;
    let recordMs = 0;

    if(!textFile) {
        deltas.binaryFiles = 1;
        deltas.skippedFiles = 1;
        const recStart = performance.now();
        fileRecord = buildSkippedFileRecord({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            extension,
            sizeBytes:        stats.size,
            mtimeMs:          stats.mtimeMs,
            fileClass,
            skipReason:       'binary-or-asset',
        });
        recordMs = performance.now() - recStart;
        return {
            fileRecord,
            chunkRecords,
            deltas,
            timings: {
                metadataMs,
                readMs,
                chunkMs,
                recordMs,
                path: discoveredFile.relative_path,
                sizeBytes: stats.size,
                indexed: false,
                fileClass,
                chunkCount: 0,
                totalMs: metadataMs + readMs + chunkMs + recordMs,
            },
        };
    }

    if(fileClass === 'generated') {
        deltas.generatedFiles = 1;
        deltas.skippedFiles = 1;
        const recStart = performance.now();
        fileRecord = buildSkippedFileRecord({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            extension,
            sizeBytes:        stats.size,
            mtimeMs:          stats.mtimeMs,
            fileClass,
            skipReason:       'generated-noise',
        });
        recordMs = performance.now() - recStart;
        return {
            fileRecord,
            chunkRecords,
            deltas,
            timings: {
                metadataMs,
                readMs,
                chunkMs,
                recordMs,
                path: discoveredFile.relative_path,
                sizeBytes: stats.size,
                indexed: false,
                fileClass,
                chunkCount: 0,
                totalMs: metadataMs + readMs + chunkMs + recordMs,
            },
        };
    }

    const readStart = performance.now();
    const text = await fs.readFile(discoveredFile.absolute_path, 'utf8');
    readMs = performance.now() - readStart;
    // Skip pathologically long-line or minified files early to avoid creating
    // huge chunks and consuming excessive CPU/memory during chunking.
    if (hasLineLongerThan(text, DEFAULT_MAX_INDEXABLE_LINE_LENGTH)) {
        deltas.skippedFiles = 1;
        const recStartLongLine = performance.now();
        fileRecord = buildSkippedFileRecord({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            extension,
            sizeBytes:        stats.size,
            mtimeMs:          stats.mtimeMs,
            fileClass,
            skipReason:       'minified-or-long-line',
        });
        recordMs = performance.now() - recStartLongLine;
        return {
            fileRecord,
            chunkRecords,
            deltas,
            timings: {
                metadataMs,
                readMs,
                chunkMs,
                recordMs,
                path: discoveredFile.relative_path,
                sizeBytes: stats.size,
                indexed: false,
                fileClass,
                chunkCount: 0,
                totalMs: metadataMs + readMs + chunkMs + recordMs,
            },
        };
    }
    // Use a local (per-file) temporary chunk id generator so per-file processing
    // doesn't rely on any shared global counter. These local ids will be
    // replaced later in runBuild(). The prefix 'local-c' is intentionally
    // distinct so tests can assert final ids don't contain it.
    let localChunkCounter = 0;
    const localChunkId = () => {
        localChunkCounter += 1;
        return `local-c${String(localChunkCounter).padStart(6, '0')}`;
    };

    const chunkStart = performance.now();
    const {lines, chunks} = chunkTextFile({
        fileId,
        relativeFilePath: discoveredFile.relative_path,
        text,
        knownBasenamesSet,
        chunkIdGenerator: localChunkId,
    });
    chunkMs = performance.now() - chunkStart;

    for(const chunk of chunks) {
        chunkRecords.push(chunk);
    }

    const recStart = performance.now();
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
    recordMs = performance.now() - recStart;

    deltas.indexedTextFiles = 1;
    const chunkCount = chunkRecords.length;
    return {
        fileRecord,
        chunkRecords,
        deltas,
        timings: {
            metadataMs,
            readMs,
            chunkMs,
            recordMs,
            path: discoveredFile.relative_path,
            sizeBytes: stats.size,
            indexed: true,
            fileClass,
            chunkCount,
            totalMs: metadataMs + readMs + chunkMs + recordMs,
        },
    };
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

