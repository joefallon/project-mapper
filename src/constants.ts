/**
 * Constants copied from project-map.mjs to keep TypeScript helpers aligned.
 * These are intentionally duplicated so we do not modify project-map.mjs.
 * Source (project-map.mjs): IGNORED_DIRECTORY_NAMES and IGNORED_RELATIVE_DIRECTORIES
 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    '.git',
    '.github',
    '.hg',
    '.svn',
    '.idea',
    '.vs',
    '.vscode',
    '.next',
    '.nuxt',
    '.obsidian',
    '.cache',
    '.turbo',
    'node_modules',
    'vendor',
    'dist',
    'build',
    'coverage',
    'tmp',
    'temp',
    '__pycache__',
]);

/**
 * Additional directory paths, relative to the project root, that should always be
 * ignored. These are expressed in normalized POSIX-style relative paths.
 */
export const IGNORED_RELATIVE_DIRECTORIES: ReadonlySet<string> = new Set([
    '.ai/out',
    '.ai/scale',
    '.ai/scale/state',
]);

/**
 * Common file extensions that are almost always binary or asset-oriented.
 *
 * Copied from `project-map.mjs` so behavior remains identical without
 * modifying the original script.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
    '.7z', '.a', '.ai', '.avi', '.bin', '.bmp', '.class', '.dll', '.dmg', '.doc',
    '.docx', '.eot', '.exe', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.lib',
    '.lockb', '.mov', '.mp3', '.mp4', '.o', '.obj', '.otf', '.pdf', '.png', '.psd',
    '.so', '.tar', '.tif', '.tiff', '.ttf', '.wav', '.webm', '.webp', '.woff', '.woff2',
    '.xls', '.xlsx', '.zip',
]);

/**
 * Some additional file names/patterns that are usually generated noise.
 *
 * Copied from `project-map.mjs` to keep behaviour identical without modifying
 * the original script.
 */
export const GENERATED_FILE_PATTERNS: ReadonlyArray<RegExp> = [
    /\.min\.[^.]+$/i,
    /\.map$/i,
    /package-lock\.json$/i,
    /pnpm-lock\.ya?ml$/i,
    /yarn\.lock$/i,
    /composer\.lock$/i,
    /diff\.diff$/i,
    /Cargo\.lock$/i,
    /poetry\.lock$/i,
];


/**
 * File classification helpers copied from `project-map.mjs` to keep behavior
 * identical without modifying the original script.
 */
export const DOC_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown', '.mdx', '.rst', '.txt', '.adoc']);
export const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.xml']);
export const DATA_EXTENSIONS: ReadonlySet<string> = new Set(['.csv', '.tsv', '.sql']);
export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.sh', '.bash', '.ps1', '.bat', '.cmd']);
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
    '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx',
    '.mjs', '.php', '.pl', '.py', '.rb', '.rs', '.scss', '.sass', '.ts', '.tsx', '.vue',
]);

export const TEST_HINTS: ReadonlyArray<string> = ['test', 'tests', 'spec', '__tests__', '.spec.', '.test.'];
export const DOC_HINTS: ReadonlyArray<string> = ['docs', 'doc', 'readme', 'guide', 'manual', 'notes', 'design', 'lore', 'campaign', 'adventure'];
export const CONFIG_HINTS: ReadonlyArray<string> = ['config', 'configs', 'settings'];


