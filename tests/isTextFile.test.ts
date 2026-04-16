import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { isTextFile } from '../src/isTextFile';

describe('isTextFile', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'project-mapper-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmp, {recursive: true, force: true});
    });

    it('returns false for known binary extension without reading file', async () => {
        const noFile = path.join(tmp, 'no-such-file.png');
        const result = await isTextFile(noFile, '.png');
        expect(result).toBe(false);
    });

    it('returns true for empty file', async () => {
        const file = path.join(tmp, 'empty.txt');
        await fs.writeFile(file, Buffer.alloc(0));
        const result = await isTextFile(file, '.txt');
        expect(result).toBe(true);
    });

    it('returns false when file contains any null byte', async () => {
        const file = path.join(tmp, 'has-null.bin');
        await fs.writeFile(file, Buffer.from([0x41, 0x00, 0x42]));
        const result = await isTextFile(file, '.bin');
        expect(result).toBe(false);
    });

    it('returns false when suspicious-control ratio is high', async () => {
        const file = path.join(tmp, 'high-suspicious.bin');
        // 100 bytes: 30 suspicious (0x01), 70 printable 'A' (0x41) -> 0.3 >= 0.25
        const buf = Buffer.alloc(100, 0x41);
        for(let i = 0; i < 30; i++) {
            buf[i] = 0x01;
        }
        await fs.writeFile(file, buf);
        const result = await isTextFile(file, '.bin');
        expect(result).toBe(false);
    });

    it('returns true when suspicious-control ratio is low', async () => {
        const file = path.join(tmp, 'low-suspicious.txt');
        // 100 bytes: 10 suspicious, 90 printable -> 0.1 < 0.25
        const buf = Buffer.alloc(100, 0x41);
        for(let i = 0; i < 10; i++) {
            buf[i] = 0x01;
        }
        await fs.writeFile(file, buf);
        const result = await isTextFile(file, '.txt');
        expect(result).toBe(true);
    });

    it('treats extension case-insensitively', async () => {
        const noFile = path.join(tmp, 'no-file.PNG');
        const result = await isTextFile(noFile, '.PNG');
        expect(result).toBe(false);
    });
});

