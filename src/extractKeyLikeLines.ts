import { truncate } from './utils';

/**
 * Extracts lines that look like keys or labels from an array of lines.
 *
 * Heuristics (ported from project-map.mjs):
 * - Accepts ASCII-only label followed by a colon and whitespace: /^...:\s+/
 * - Or accepts NAME = value style assignments: /^[A-Za-z0-9_.-]+\s*=\s+/
 * - Trims lines, skips blank lines, truncates matched lines to 160 chars.
 * - Stops after `limit` matches (default 8). When limit === 0 the first
 *   match is still pushed then the loop breaks to preserve original behavior.
 */
export function extractKeyLikeLines(lines: string[], limit = 8): string[] {
    const results: string[] = [];

    for(const line of lines) {
        const trimmed = line.trim();

        if(!trimmed) {
            continue;
        }

        if(/^[A-Za-z0-9 _.-]{2,60}:\s+/.test(trimmed) || /^[A-Za-z0-9_.-]+\s*=\s+/.test(trimmed)) {
            results.push(truncate(trimmed, 160));
        }

        if(results.length >= limit) {
            break;
        }
    }

    return results;
}

