import { IGNORED_DIRECTORY_NAMES, IGNORED_RELATIVE_DIRECTORIES } from './constants';

/**
 * Returns true when a relative path is under a specifically ignored relative
 * directory such as .ai/scale/state.
 *
 * Behavior mirrors project-map.mjs: minimal normalization (strip leading './')
 * and exact, case-sensitive matching against the configured set.
 */
export function isUnderIgnoredRelativeDirectory(relativePath: string): boolean {
    const normalized = relativePath === '.' ? '.' : relativePath.replace(/^\.\//, '');

    for(const ignoredDirectory of IGNORED_RELATIVE_DIRECTORIES) {
        if(normalized === ignoredDirectory || normalized.startsWith(`${ignoredDirectory}/`)) {
            return true;
        }
    }

    return false;
}

/**
 * Determines whether a directory should be ignored.
 *
 * Returns true when the directory basename is a known ignored name, or when the
 * directory's project-relative path falls under an ignored relative directory.
 */
export function shouldIgnoreDirectory(relativeDirectoryPath: string, directoryName: string): boolean {
    if(IGNORED_DIRECTORY_NAMES.has(directoryName)) {
        return true;
    }

    return isUnderIgnoredRelativeDirectory(relativeDirectoryPath);
}

