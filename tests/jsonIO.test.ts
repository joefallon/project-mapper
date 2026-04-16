import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import prettyJson from '../src/prettyJson';
import { writeJson, writeJsonLines, readJson, readJsonLines } from '../src/jsonIO';

describe('jsonIO helpers', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'project-mapper-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmp, {recursive: true, force: true});
    });

    it('writeJson writes pretty JSON with trailing EOL and readJson parses it', async () => {
        const file = path.join(tmp, 'obj.json');
        const value = {b: 1, a: {nested: true}};

        await writeJson(file, value);

        const actual = await fs.readFile(file, 'utf8');
        expect(actual).toBe(`${prettyJson(value)}${os.EOL}`);

        const parsed = await readJson<typeof value>(file);
        expect(parsed).toEqual(value);
    });

    it('writeJsonLines writes newline-delimited JSON and readJsonLines reads them', async () => {
        const file = path.join(tmp, 'lines.jsonl');
        const records = [{id: 1}, {id: 2, name: 'x'}];

        await writeJsonLines(file, records);

        const text = await fs.readFile(file, 'utf8');
        expect(text).toBe(records.map((r) => JSON.stringify(r)).join('\n') + '\n');

        const parsed = await readJsonLines(file);
        expect(parsed).toEqual(records);
    });

    it('writeJsonLines writes empty file for empty array and readJsonLines returns [] for empty/whitespace-only', async () => {
        const file = path.join(tmp, 'empty.jsonl');

        await writeJsonLines(file, []);
        let text = await fs.readFile(file, 'utf8');
        expect(text).toBe('');

        let parsed = await readJsonLines(file);
        expect(parsed).toEqual([]);

        // whitespace-only file should also return []
        await fs.writeFile(file, '  \n\t\r\n', 'utf8');
        parsed = await readJsonLines(file);
        expect(parsed).toEqual([]);
    });

    it('readJsonLines tolerates CRLF and ignores blank lines', async () => {
        const file = path.join(tmp, 'crlf.jsonl');
        const lines = ['{"x":1}', '', '{"y":2}'];
        await fs.writeFile(file, lines.join('\r\n') + '\r\n', 'utf8');

        const parsed = await readJsonLines(file);
        expect(parsed).toEqual([{x: 1}, {y: 2}]);
    });
});

