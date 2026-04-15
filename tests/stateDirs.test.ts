import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  removeDirectoryIfPresent,
  ensureScaleDirectory,
  ensureStateDirectories,
} from '../src/stateDirs';

async function makeTempDir(): Promise<string> {
  const prefix = path.join(os.tmpdir(), 'project-mapper-test-');
  return fs.mkdtemp(prefix);
}

describe('stateDirs helpers', () => {
  it('removeDirectoryIfPresent removes an existing directory recursively', async () => {
    const tmp = await makeTempDir();
    try {
      const target = path.join(tmp, 'to-remove');
      const nested = path.join(target, 'nested');
      await fs.mkdir(nested, { recursive: true });
      await fs.writeFile(path.join(nested, 'file.txt'), 'hello', 'utf8');

      // ensure it exists
      const statBefore = await fs.stat(target);
      expect(statBefore.isDirectory()).toBe(true);

      await removeDirectoryIfPresent(target);

      // after removal, stat should fail
      let threw = false;
      try {
        await fs.stat(target);
      } catch (err) {
        threw = true;
      }

      expect(threw).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('removeDirectoryIfPresent does not throw when path is missing', async () => {
    const tmp = await makeTempDir();
    try {
      const target = path.join(tmp, 'does-not-exist');
      // Should resolve without throwing
      await expect(removeDirectoryIfPresent(target)).resolves.toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('ensureScaleDirectory creates the scale directory (including parent)', async () => {
    const tmp = await makeTempDir();
    try {
      const aiDir = path.join(tmp, '.ai');
      const scaleDir = path.join(aiDir, 'scale');

      // ensure parent does not exist
      await fs.rm(aiDir, { recursive: true, force: true });

      await ensureScaleDirectory(scaleDir);

      const stat = await fs.stat(scaleDir);
      expect(stat.isDirectory()).toBe(true);

      // idempotent: call again
      await ensureScaleDirectory(scaleDir);
      const stat2 = await fs.stat(scaleDir);
      expect(stat2.isDirectory()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('ensureStateDirectories creates postings, synopses dirs/files and queries under state dir', async () => {
    const tmp = await makeTempDir();
    try {
      const stateDir = path.join(tmp, '.ai', 'scale', 'state');

      await ensureStateDirectories(stateDir);

      const postings = path.join(stateDir, 'postings');
      const synopsesDirs = path.join(stateDir, 'synopses', 'dirs');
      const synopsesFiles = path.join(stateDir, 'synopses', 'files');
      const queries = path.join(stateDir, 'queries');

      const s1 = await fs.stat(postings);
      const s2 = await fs.stat(synopsesDirs);
      const s3 = await fs.stat(synopsesFiles);
      const s4 = await fs.stat(queries);

      expect(s1.isDirectory()).toBe(true);
      expect(s2.isDirectory()).toBe(true);
      expect(s3.isDirectory()).toBe(true);
      expect(s4.isDirectory()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

