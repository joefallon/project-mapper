import fs from 'node:fs/promises';
import path from 'path';

export async function readJson(filePath: string) {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
}

export async function writeJson(filePath: string, obj: unknown) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, {recursive: true});
    await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

export async function readJsonLines(filePath: string) {
    const text = await fs.readFile(filePath, 'utf8');
    if(!text) {
        return [];
    }
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function writeJsonLines(filePath: string, objects: unknown[]) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, {recursive: true});
    const stream = objects.map((o) => JSON.stringify(o)).join('\n') + '\n';
    await fs.writeFile(filePath, stream, 'utf8');
}

export async function ensureScaleDirectory(aiDir: string) {
    await fs.mkdir(aiDir, {recursive: true});
}

export async function ensureStateDirectories(paths: {
    STATE_DIR: string;
    POSTINGS_DIR: string;
    SYNOPSES_DIRS_DIR: string;
    SYNOPSES_FILES_DIR: string;
    QUERIES_DIR: string;
}) {
    await fs.mkdir(paths.STATE_DIR, {recursive: true});
    await fs.mkdir(paths.POSTINGS_DIR, {recursive: true});
    await fs.mkdir(paths.SYNOPSES_DIRS_DIR, {recursive: true});
    await fs.mkdir(paths.SYNOPSES_FILES_DIR, {recursive: true});
    await fs.mkdir(paths.QUERIES_DIR, {recursive: true});
}

export async function removeDirectoryIfPresent(pathToRemove: string) {
    try {
        await fs.rm(pathToRemove, {recursive: true, force: true});
    } catch(err) {
        // ignore
    }
}

