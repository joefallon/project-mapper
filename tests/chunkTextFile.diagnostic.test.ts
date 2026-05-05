import { chunkTextFile } from '../src/chunkTextFile';
import { test, expect, vi } from 'vitest';

test('chunkTextFile prints diagnostics when slow', () => {
    // Spy on performance.now to simulate a slow execution path without waiting.
    const perf = require('node:perf_hooks');
    const originalNow = perf.performance.now;
    let call = 0;
    // Each call advances by 500ms so totalElapsed will exceed the 1000ms threshold.
    vi.spyOn(perf.performance, 'now').mockImplementation(() => {
        call += 1;
        return call * 500;
    });

    const logs: any[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
        logs.push(args.join(' '));
    });

    const text = Array.from({length: 200}, () => 'line of text').join('\n');

    const { lines, chunks } = chunkTextFile({
        fileId: 'f000001',
        relativeFilePath: 'large/file.js',
        text,
        chunkIdGenerator: (() => { let c = 0; return () => `local-c${String(++c).padStart(6,'0')}`; })(),
    });

    // Basic sanity of returned shape
    expect(lines.length).toBeGreaterThan(0);
    expect(Array.isArray(chunks)).toBe(true);

    // Diagnostic log should have been emitted
    expect(logs.some((l) => l.includes('SLOW CHUNK FILE DIAGNOSTIC'))).toBe(true);

    // Restore
    logSpy.mockRestore();
    (perf.performance.now as any).mockRestore?.();
    perf.performance.now = originalNow;
});

