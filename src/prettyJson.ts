/**
 * Stable JSON stringify helper ported from project-map.mjs.
 *
 * Keeps persisted JSON output tidy and human-readable by using 2-space
 * indentation. Mirrors the original runtime behavior where JSON.stringify may
 * return `undefined` for unsupported inputs (e.g. `undefined`).
 */
export function prettyJson(value: unknown): string | undefined {
    return JSON.stringify(value, null, 2);
}

export default prettyJson;

