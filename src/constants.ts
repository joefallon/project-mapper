/**
 * Constants copied from project-map.mjs to keep TypeScript helpers aligned.
 * These are intentionally duplicated so we do not modify project-map.mjs.
 * Source (project-map.mjs): IGNORED_DIRECTORY_NAMES and IGNORED_RELATIVE_DIRECTORIES
 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
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

