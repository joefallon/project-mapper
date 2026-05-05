import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'path';
import os from 'os';

import { runBuild } from '../../src/projectMap/build/collect';

describe('runBuild long-line skip', () => {
    it('skips a text file containing a line longer than DEFAULT_MAX_INDEXABLE_LINE_LENGTH', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-longline-'));
        try {
            const longLine = 'a'.repeat(2000 + 10); // intentionally > threshold
            await fs.writeFile(path.join(tmp, 'huge.js'), longLine);

            const { buildInfo, fileRecords, chunkRecords } = await runBuild(tmp);

            expect(buildInfo.total_files_seen).toBe(1);
            expect(buildInfo.indexed_text_files).toBe(0);
            expect(buildInfo.skipped_files).toBe(1);
            expect(chunkRecords.length).toBe(0);

            expect(fileRecords.length).toBe(1);
            const fr = fileRecords[0];
            expect(fr.indexed).toBe(false);
            expect(fr.skip_reason).toBe('minified-or-long-line');
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});

