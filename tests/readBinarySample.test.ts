import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { readBinarySample } from '../src/readBinarySample';

describe('readBinarySample', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'project-mapper-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmp, {recursive: true, force: true});
    });

    it('reads entire file when file is smaller than maxBytes', async () => {
        const file = path.join(tmp, 'small.bin');
        const content = Buffer.from('a'.repeat(100), 'utf8');
        await fs.writeFile(file, content);

        const sample = await readBinarySample(file, 4096);
        expect(sample).toBeInstanceOf(Buffer);
        expect(sample.length).toBe(content.length);
        expect(sample.equals(content)).toBe(true);
    });

    it('truncates to maxBytes when file is larger', async () => {
        const file = path.join(tmp, 'large.bin');
        const content = Buffer.alloc(1000, 0x41); // 1000 'A' bytes
        await fs.writeFile(file, content);

        const sample = await readBinarySample(file, 128);
        expect(sample.length).toBe(128);
        expect(sample.equals(content.subarray(0, 128))).toBe(true);
    });

    it('returns empty buffer for empty file', async () => {
        const file = path.join(tmp, 'empty.bin');
        await fs.writeFile(file, Buffer.alloc(0));

        const sample = await readBinarySample(file, 4096);
        expect(sample.length).toBe(0);
    });

    it('rejects for non-existent file', async () => {
        const file = path.join(tmp, 'no-such-file.bin');
        await expect(readBinarySample(file, 128)).rejects.toThrow();
    });

    it('returns empty buffer when maxBytes is 0', async () => {
        const file = path.join(tmp, 'some.bin');
        const content = Buffer.from('hello world', 'utf8');
        await fs.writeFile(file, content);

        const sample = await readBinarySample(file, 0);
        expect(sample.length).toBe(0);
    });
});

