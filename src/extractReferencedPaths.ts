import path from 'path';

/**
 * Extracts filename/path references from text where obvious.
 *
 * Ported from project-map.mjs: keeps behavior identical — returns up to 12
 * unique references, strips a leading `./`, filters by knownBasenamesSet when
 * provided, and preserves first-seen order.
 */
export function extractReferencedPaths(text: string | null | undefined,
                                       knownBasenamesSet?: Set<string>): string[] {
    const matches = String(text ?? '').match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
    const references: string[] = [];
    const seen = new Set<string>();

    for(const match of matches) {
        const normalized = match.replace(/^\.\//, '');
        const basename = path.posix.basename(normalized);

        if(knownBasenamesSet && !knownBasenamesSet.has(basename)) {
            continue;
        }

        if(!seen.has(normalized)) {
            seen.add(normalized);
            references.push(normalized);
        }

        if(references.length >= 12) {
            break;
        }
    }

    return references;
}

