import { STOPWORDS } from './stopwords';
import type { IdentifierCount } from './types';

const DEFAULT_TOP_IDENTIFIERS = 12;

export function extractIdentifiers(text: string, limit = DEFAULT_TOP_IDENTIFIERS): IdentifierCount[] {
    const matches = String(text ?? '').match(/[A-Za-z_][A-Za-z0-9_:-]{2,}/g) ?? [];
    const counts = new Map<string, number>();

    for(const match of matches) {
        const looksAllLower = /^[a-z0-9_:-]+$/.test(match);
        const looksCommonWord = STOPWORDS.has(match.toLowerCase());

        if(looksAllLower && looksCommonWord) {
            continue;
        }

        counts.set(match, (counts.get(match) ?? 0) + 1);
    }

    return [...counts.entries()]
        .sort((left, right) => {
            const countDelta = right[1] - left[1];
            if(countDelta !== 0) {
                return countDelta;
            }

            return left[0].localeCompare(right[0]);
        })
        .slice(0, limit)
        .map(([identifier, count]) => ({identifier, count}));
}

