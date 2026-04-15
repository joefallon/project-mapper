import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Removes a directory tree if it exists. This mirrors the behavior in
 * project-map.mjs and is intentionally permissive: no error is thrown when the
 * path is missing.
 */
export async function removeDirectoryIfPresent(directoryPath: string): Promise<void> {
  // Delegate to fs.rm with force+recursive to match original behavior.
  await fs.rm(directoryPath, { recursive: true, force: true });
}

/**
 * Ensures the scale directory exists. The caller provides the exact path so the
 * function is easy to test. This mirrors project-map.mjs's ensureScaleDirectory.
 */
export async function ensureScaleDirectory(scaleDir: string): Promise<void> {
  await fs.mkdir(scaleDir, { recursive: true });
}

/**
 * Ensures the common generated-state subdirectories exist under the provided
 * state directory. Mirrors ensureStateDirectories from project-map.mjs but
 * accepts the base path explicitly for testability.
 */
export async function ensureStateDirectories(stateDir: string): Promise<void> {
  const postingsDir = path.join(stateDir, 'postings');
  const synopsesDir = path.join(stateDir, 'synopses');
  const synopsesDirsDir = path.join(synopsesDir, 'dirs');
  const synopsesFilesDir = path.join(synopsesDir, 'files');
  const queriesDir = path.join(stateDir, 'queries');

  await fs.mkdir(postingsDir, { recursive: true });
  await fs.mkdir(synopsesDirsDir, { recursive: true });
  await fs.mkdir(synopsesFilesDir, { recursive: true });
  await fs.mkdir(queriesDir, { recursive: true });
}

