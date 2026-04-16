import { GENERATED_FILE_PATTERNS } from './constants';

/**
 * Determines whether a file path looks generated or otherwise undesirable for
 * indexing.
 */
export function looksGenerated(relativeFilePath: string): boolean {
    return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(relativeFilePath));
}

