import { describe, it, expect, vi } from 'vitest';
import { buildChunkRecord } from '../src/buildChunkRecord';
import { performance } from 'perf_hooks';

describe('buildChunkRecord diagnostics (console-only)', () => {
    it('prints a slow-chunk diagnostic when total time exceeds threshold', () => {
        // Prepare a deterministic increasing performance.now() sequence that
        // results in total > 1000ms. The implementation calls performance.now()
        // many times; provide enough values.
        const times = [
            0,    // t0
            1,    // t1
            11,   // t2
            21,   // t3
            31,   // t4
            1005, // t5
            1006, // t6
            1007, // t7
            1008, // t8
            1009, // t9
            1010, // t10
            1011, // tFinal
        ];
        let idx = 0;
        const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
            const v = times[idx] ?? times[times.length - 1];
            idx += 1;
            return v;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        try {
            const lines = [
                'Title: Diagnostic Test',
                "function Slow() { return 'x'; }",
                'See ./README.md',
                'KEY = VALUE',
                '"quoted"',
            ];

            const rec = buildChunkRecord({
                chunkId: 'diag-1',
                fileId: 'fdiag',
                relativeFilePath: 'src/diag.ts',
                lines,
                startLine: 1,
                endLine: lines.length,
                kind: 'code',
                title: 'Diagnostic Test',
            });

            // Diagnostic should have been printed because mocked total > 1000ms
            const called = consoleSpy.mock.calls.length > 0;
            expect(called).toBe(true);

            // Ensure header mentioning slow build appears
            const joined = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
            expect(joined).toContain('SLOW BUILD CHUNK RECORD');
            expect(joined).toContain('diag-1');

            // Ensure returned record shape is intact
            expect(rec.chunk_id).toBe('diag-1');
            expect(rec.text).toBe(lines.join('\n'));
        } finally {
            perfSpy.mockRestore();
            consoleSpy.mockRestore();
        }
    });
});

