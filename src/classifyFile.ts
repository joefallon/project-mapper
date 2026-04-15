import { looksGenerated } from './looksGenerated';
import {
  DOC_EXTENSIONS,
  CONFIG_EXTENSIONS,
  DATA_EXTENSIONS,
  SCRIPT_EXTENSIONS,
  SOURCE_EXTENSIONS,
  TEST_HINTS,
  DOC_HINTS,
  CONFIG_HINTS,
} from './constants';

export type FileClass =
  | 'binary'
  | 'generated'
  | 'test'
  | 'doc'
  | 'config'
  | 'data'
  | 'script'
  | 'source'
  | 'asset'
  | 'unknown';

/**
 * Returns a coarse file class from the path/extension.
 * Ported from project-map.mjs. The function expects the caller to pass a
 * lower-cased extension when the original code did; however, this function
 * will work if extension is any case.
 */
export function classifyFile(relativeFilePath: string, extension: string, isTextFile: boolean): FileClass {
  const lowerPath = relativeFilePath.toLowerCase();
  const ext = String(extension ?? '').toLowerCase();

  if (!isTextFile) {
    return 'binary';
  }

  if (looksGenerated(relativeFilePath)) {
    return 'generated';
  }

  if (TEST_HINTS.some((hint) => lowerPath.includes(hint))) {
    return 'test';
  }

  if (DOC_EXTENSIONS.has(ext) || DOC_HINTS.some((hint) => lowerPath.includes(hint))) {
    return 'doc';
  }

  if (CONFIG_EXTENSIONS.has(ext) || CONFIG_HINTS.some((hint) => lowerPath.includes(hint))) {
    return 'config';
  }

  if (DATA_EXTENSIONS.has(ext)) {
    return 'data';
  }

  if (SCRIPT_EXTENSIONS.has(ext)) {
    return 'script';
  }

  if (SOURCE_EXTENSIONS.has(ext)) {
    return 'source';
  }

  // This branch mirrors the original script but is unreachable because we
  // return 'binary' earlier when !isTextFile. Mark as ignored for coverage
  // so coverage tools don't penalize the file for the unreachable line.
  /* istanbul ignore next */
  if (ext && !isTextFile) {
    return 'asset';
  }

  return isTextFile ? 'unknown' : 'asset';
}

