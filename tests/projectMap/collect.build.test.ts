import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'path';
import os from 'os';

import { runBuild } from '../../src/projectMap/build/collect';
import { loadCoreState } from '../../src/projectMap/state';

describe('runBuild determinism (focused)', () => {
    it('produces stable file/chunk ids, ordering, skipped flags, and persisted state', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-test-'));
        try {
            // Create a small fixture with nested dirs, a generated file, and a binary asset
            await fs.mkdir(path.join(tmp, 'a'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'assets'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'b'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'nested', 'c'), { recursive: true });

            await fs.writeFile(path.join(tmp, 'a', 'alpha.txt'), 'Alpha file contents\nline2');
            // binary asset (PNG extension is treated as binary)
            await fs.writeFile(path.join(tmp, 'assets', 'image.png'), Buffer.from([0, 1, 2, 3]));
            await fs.writeFile(path.join(tmp, 'b', 'beta.ts'), 'const beta = 1;\nexport {}\n');
            await fs.writeFile(path.join(tmp, 'nested', 'c', 'gamma.js'), 'function gamma() { return 42; }\n');
            // generated file pattern (package-lock.json) should be classified as generated and skipped
            await fs.writeFile(path.join(tmp, 'package-lock.json'), JSON.stringify({ locked: true }));

            const { buildInfo, repoSynopsis, fileRecords, chunkRecords } = await runBuild(tmp);

            // Basic counters
            expect(buildInfo.total_files_seen).toBe(5);
            expect(buildInfo.indexed_text_files).toBe(3);
            expect(buildInfo.skipped_files).toBe(2);
            expect(buildInfo.total_chunks).toBe(chunkRecords.length);
            expect(repoSynopsis.total_chunks).toBe(chunkRecords.length);

            // Expected discovery order (lexicographic per-directory)
            const expectedPaths = [
                'a/alpha.txt',
                'assets/image.png',
                'b/beta.ts',
                'nested/c/gamma.js',
                'package-lock.json',
            ];

            expect(fileRecords.map((f) => f.path)).toEqual(expectedPaths);

            // File IDs are sequential and deterministic
            expect(fileRecords.map((f) => f.file_id)).toEqual([
                'f000001',
                'f000002',
                'f000003',
                'f000004',
                'f000005',
            ]);

            // Chunk records should be sequentially numbered
            expect(chunkRecords.length).toBeGreaterThanOrEqual(3);
            const chunkIds = chunkRecords.map((c) => c.chunk_id);
            for (let i = 0; i < chunkIds.length; i++) {
                const expected = `c${String(i + 1).padStart(7, '0')}`;
                expect(chunkIds[i]).toBe(expected);
            }

            // No final chunk id should use the temporary local prefix
            for (const id of chunkIds) {
                expect(id.startsWith('local-')).toBe(false);
            }

            // Every indexed file's chunk_ids should exactly match the final chunkRecords for that file
            const chunksByFile: Record<string, string[]> = {};
            for (const c of chunkRecords) {
                chunksByFile[c.file_id] = chunksByFile[c.file_id] ?? [];
                chunksByFile[c.file_id].push(c.chunk_id);
            }

            for (const fr of fileRecords.filter((f) => f.indexed)) {
                const expected = chunksByFile[fr.file_id] ?? [];
                expect(fr.chunk_ids).toEqual(expected);
            }

            // Skipped files carry expected reasons and indexed=false
            const assetRecord = fileRecords.find((r) => r.path === 'assets/image.png');
            expect(assetRecord).toBeDefined();
            expect(assetRecord.indexed).toBe(false);
            expect(assetRecord.skip_reason).toBe('binary-or-asset');

            const generatedRecord = fileRecords.find((r) => r.path === 'package-lock.json');
            expect(generatedRecord).toBeDefined();
            expect(generatedRecord.indexed).toBe(false);
            expect(generatedRecord.skip_reason).toBe('generated-noise');

            // Persisted state files exist
            const stateDir = path.join(tmp, '.ai', 'scale', 'state');
            const required = ['build.json', 'repo.json', 'files.jsonl', 'chunks.jsonl', 'dirs.jsonl'];
            for (const n of required) {
                await fs.access(path.join(stateDir, n));
            }

            // Existing state loader can read the generated state
            const loaded = await loadCoreState(tmp);
            expect(loaded.fileRecords.length).toBe(fileRecords.length);
            expect(loaded.chunkRecords.length).toBe(chunkRecords.length);
        } finally {
            // Cleanup fixture
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});

