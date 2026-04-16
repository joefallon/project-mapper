import path from 'path';
import { readJson, readJsonLines } from './io';
import { getPaths } from './constants';
import fs from 'node:fs/promises';

export async function assertStatePresent(projectRoot?: string) {
    const paths = getPaths(projectRoot);
    try {
        await fs.access(path.join(paths.STATE_DIR, 'build.json'));
        await fs.access(path.join(paths.STATE_DIR, 'repo.json'));
        await fs.access(path.join(paths.STATE_DIR, 'files.jsonl'));
        await fs.access(path.join(paths.STATE_DIR, 'chunks.jsonl'));
    } catch {
        throw new Error('ProjectMap state is missing or incomplete. Run: node .ai/scale/project-map.mjs build');
    }
}

export async function loadCoreState(projectRoot?: string) {
    await assertStatePresent(projectRoot);
    const paths = getPaths(projectRoot);

    const [buildInfo, repoInfo, fileRecords, chunkRecords, directoryRecords] = await Promise.all([
        readJson(path.join(paths.STATE_DIR, 'build.json')),
        readJson(path.join(paths.STATE_DIR, 'repo.json')),
        readJsonLines(path.join(paths.STATE_DIR, 'files.jsonl')),
        readJsonLines(path.join(paths.STATE_DIR, 'chunks.jsonl')),
        readJsonLines(path.join(paths.STATE_DIR, 'dirs.jsonl')).catch(() => []),
    ]);

    const filesById = new Map();
    const filesByPath = new Map();

    for(const fileRecord of fileRecords) {
        filesById.set(fileRecord.file_id, fileRecord);
        filesByPath.set(fileRecord.path, fileRecord);
    }

    const chunksById = new Map();
    const chunksByFileId = new Map();

    for(const chunkRecord of chunkRecords) {
        chunksById.set(chunkRecord.chunk_id, chunkRecord);

        if(!chunksByFileId.has(chunkRecord.file_id)) {
            chunksByFileId.set(chunkRecord.file_id, []);
        }

        chunksByFileId.get(chunkRecord.file_id).push(chunkRecord);
    }

    const dirsById = new Map();
    const dirsByPath = new Map();

    for(const directoryRecord of directoryRecords) {
        dirsById.set(directoryRecord.dir_id, directoryRecord);
        dirsByPath.set(directoryRecord.path, directoryRecord);
    }

    return {
        buildInfo,
        repoInfo,
        fileRecords,
        chunkRecords,
        directoryRecords,
        filesById,
        filesByPath,
        chunksById,
        chunksByFileId,
        dirsById,
        dirsByPath,
    };
}

