import fs from 'node:fs/promises';
import path from 'path';
import { getPaths, PROJECT_MAP_VERSION } from '../constants';
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
    // ensure .ai/scale exists
    await ensureScaleDirectory(paths.AI_DIR);

    // Per the operating model: remove any existing state and create fresh dirs
    await removeDirectoryIfPresent(paths.STATE_DIR);
    await ensureStateDirectories(paths);

    const buildStartedAt = new Date().toISOString();
    const discoveredFiles = await collectProjectFiles(projectRoot);
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

    // Process files serially but with local (per-file) chunk ids. We'll finalize global
    // chunk ids in a separate ordered step below to make per-file processing safe for
    // future concurrency.
    const processedFiles: Array<{
        fileRecord: any;
        chunkRecords: any[];
        deltas: { indexedTextFiles: number; skippedFiles: number; binaryFiles: number; generatedFiles: number };
    }> = [];

    for(const discoveredFile of discoveredFiles) {
        const fileId = nextFileId();
        const processed = await processDiscoveredFileForBuild({
            discoveredFile,
            fileId,
            knownBasenamesSet,
        });

        processedFiles.push(processed);

        // Update counters
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

    printBuildSummary(buildInfo, repoSynopsis);
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

function printBuildSummary(buildInfo: any, repoSynopsis: any) {
    console.log('PROJECT MAP BUILD COMPLETE');
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

