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

    for(const discoveredFile of discoveredFiles) {
        const stats = await fs.stat(discoveredFile.absolute_path);
        const extension = path.extname(discoveredFile.relative_path).toLowerCase();
        const textFile = await isTextFile(discoveredFile.absolute_path, extension);
        const fileClass = classifyFile(discoveredFile.relative_path, extension, textFile);
        const fileId = nextFileId();

        if(!textFile) {
            binaryFiles += 1;
            skippedFiles += 1;
            fileRecords.push(buildSkippedFileRecord({
                fileId,
                relativeFilePath: discoveredFile.relative_path,
                extension,
                sizeBytes:        stats.size,
                mtimeMs:          stats.mtimeMs,
                fileClass,
                skipReason:       'binary-or-asset',
            }));
            continue;
        }

        if(fileClass === 'generated') {
            generatedFiles += 1;
            skippedFiles += 1;
            fileRecords.push(buildSkippedFileRecord({
                fileId,
                relativeFilePath: discoveredFile.relative_path,
                extension,
                sizeBytes:        stats.size,
                mtimeMs:          stats.mtimeMs,
                fileClass,
                skipReason:       'generated-noise',
            }));
            continue;
        }

        const text = await fs.readFile(discoveredFile.absolute_path, 'utf8');
        const {lines, chunks} = chunkTextFile({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            text,
            knownBasenamesSet,
            chunkIdGenerator: nextChunkId,
        });

        for(const chunk of chunks) {
            addChunkToPostings(postings, chunk);
            chunkRecords.push(chunk);
        }

        fileRecords.push(buildIndexedFileRecord({
            fileId,
            relativeFilePath: discoveredFile.relative_path,
            extension,
            sizeBytes:        stats.size,
            mtimeMs:          stats.mtimeMs,
            fileClass,
            text,
            lines,
            chunks,
        }));

        indexedTextFiles += 1;
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

