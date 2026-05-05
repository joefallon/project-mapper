import path from 'path';

export const DEFAULT_TOP_FILE_RESULTS = 8;
export const DEFAULT_TOP_CHUNK_RESULTS = 12;
export const DEFAULT_TOP_RELATED_FILES = 8;
export const DEFAULT_TOP_TERMS = 15;
export const DEFAULT_TOP_IDENTIFIERS = 12;

export const FALLBACK_CHUNK_LINES = 80;
export const FALLBACK_CHUNK_OVERLAP = 20;
export const STRUCTURE_MAX_SECTION_LINES = 160;

export const IGNORED_DIRECTORY_NAMES = new Set([
    '.git', '.hg', '.svn', '.idea', '.vscode', '.next', '.nuxt', '.obsidian', '.cache',
    '.turbo', 'node_modules', 'vendor', 'dist', 'build', 'coverage', 'tmp', 'temp', '__pycache__',
]);

export const IGNORED_RELATIVE_DIRECTORIES = new Set([
    '.ai/out', '.ai/scale', 'state',
]);

export function getPaths(projectRoot?: string) {
    const PROJECT_ROOT = projectRoot ?? process.cwd();
    const AI_DIR = path.join(PROJECT_ROOT, '.ai');
    const SCALE_DIR = path.join(AI_DIR, 'scale');
    // Historically state lived under .ai/scale/state. Use the scale directory
    // so build output (state/) is placed under `.ai/scale/state`.
    const STATE_DIR = path.join(SCALE_DIR, 'state');
    const POSTINGS_DIR = path.join(STATE_DIR, 'postings');
    const SYNOPSES_DIR = path.join(STATE_DIR, 'synopses');
    const SYNOPSES_DIRS_DIR = path.join(SYNOPSES_DIR, 'dirs');
    const SYNOPSES_FILES_DIR = path.join(SYNOPSES_DIR, 'files');
    const QUERIES_DIR = path.join(STATE_DIR, 'queries');

    return {
        PROJECT_ROOT,
        AI_DIR,
        SCALE_DIR,
        STATE_DIR,
        POSTINGS_DIR,
        SYNOPSES_DIR,
        SYNOPSES_DIRS_DIR,
        SYNOPSES_FILES_DIR,
        QUERIES_DIR,
    };
}

// Small version marker used in persisted state
export const PROJECT_MAP_VERSION = '1.0.0';

// Maximum allowed concurrency for project-map build per-file processing. This is
// a conservative cap to avoid overloading a developer machine. It is used by the
// build collector to clamp the detected available parallelism.
export const DEFAULT_BUILD_CONCURRENCY_LIMIT = 8;

