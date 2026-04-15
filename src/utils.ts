/**
 * Returns true when the provided value is a non-empty string after trimming.
 *
 * Purpose: lightweight helper used throughout the codebase to check whether a
 * candidate string contains meaningful text (not just whitespace).
 *
 * Parameters:
 * - value: unknown - the value to test (commonly a string or undefined/null).
 *
 * Returns: boolean - true when `value` is a string and trimming it yields length > 0.
 */
export function hasText(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Truncates a string to a maximum length and appends an ellipsis when truncated.
 *
 * Behavior:
 * - If `value` is empty or only whitespace, returns an empty string.
 * - If `value` length is <= maxLength, returns `value` unchanged.
 * - Otherwise returns a shortened string with `...` appended such that the
 *   total length is at most `maxLength`.
 *
 * Parameters:
 * - value: string - source text to truncate.
 * - maxLength: number (default 240) - maximum returned length including ellipsis.
 *
 * Returns: string - truncated or original text.
 */
export function truncate(value: string, maxLength = 240): string {
    if(!hasText(value)) {
        return '';
    }
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

/**
 * Normalizes arbitrary whitespace in a string by replacing runs of whitespace
 * (spaces, tabs, newlines) with a single space and trimming ends.
 *
 * Use when producing compact, human-friendly previews or normalized text for
 * comparisons/searches.
 *
 * Parameters:
 * - value: string - input text (undefined/null tolerated).
 *
 * Returns: string - whitespace-normalized string.
 */
export function normalizeWhitespace(value: string): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Convert Windows-style backslash separators to POSIX-style forward slashes.
 *
 * Purpose: ensure persisted relative paths are normalized with forward slashes
 * so they are consistent across platforms.
 *
 * Parameters:
 * - inputPath: string - path to normalize.
 *
 * Returns: string - path with backslashes replaced by '/'.
 */
export function toPosixPath(inputPath: string): string {
    return inputPath.replace(/\\/g, '/');
}

/**
 * Create a filesystem-safe, lowercase slug from an arbitrary string.
 *
 * Behavior:
 * - Trims and lowercases the input
 * - Replaces disallowed characters with '-'
 * - Collapses multiple '-' and trims leading/trailing dashes
 * - Returns `fallback` when the cleaned result is empty
 *
 * Parameters:
 * - value: string | undefined - input to slugify.
 * - fallback: string - value to return when slug would be empty (default 'query').
 *
 * Returns: string - safe slug for use in filenames/identifiers.
 */
export function safeSlug(value: string | undefined, fallback = 'query'): string {
    const cleaned = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');

    return cleaned || fallback;
}

/**
 * Split a CamelCase or PascalCase token into constituent words.
 *
 * Examples:
 *  - SalesOrderView -> ["Sales", "Order", "View"]
 *  - HTTPServer -> ["HTTP", "Server"]
 *
 * Parameters:
 * - token: string - input token to split.
 *
 * Returns: string[] - array of sub-tokens (non-empty).
 */
export function splitCamelCase(token: string): string[] {
    return token
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Normalize a candidate indexing term.
 *
 * Behavior:
 * - Converts to string, trims, lowercases
 * - Removes leading/trailing punctuation commonly found in tokens
 *
 * Parameters:
 * - term: string - token to normalize.
 *
 * Returns: string - normalized term (may be empty).
 */
export function normalizeTerm(term: string): string {
    return String(term ?? '').trim().toLowerCase().replace(/^[-_.:\/]+|[-_.:\/]+$/g, '');
}

/**
 * Heuristic that decides whether a normalized term is worth indexing.
 *
 * Rules (minimal and intentionally conservative):
 * - Reject empty or single-character terms
 * - Reject a small set of common stopwords
 * - Reject short all-numeric tokens (e.g., years/ids shorter than 4 digits)
 *
 * Parameters:
 * - term: string - normalized term (lowercased and trimmed is expected).
 *
 * Returns: boolean - true when term should be kept for indexing.
 */
export function isUsefulTerm(term: string): boolean {
    if(!term || term.length < 2) {
        return false;
    }
    // minimal stopword set for tests
    const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to']);
    if(STOPWORDS.has(term)) {
        return false;
    }
    if(/^\d+$/.test(term) && term.length < 4) {
        return false;
    }
    return true;
}

/**
 * Build a frequency map from an array of terms.
 *
 * Parameters:
 * - terms: string[] - list of terms (may contain duplicates).
 *
 * Returns: Map<string, number> - mapping term -> count.
 */
export function countTerms(terms: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for(const term of terms) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return counts;
}

/**
 * Return the top-N terms and counts from a Map of term counts.
 *
 * Ordering: primary by descending count, secondary by lexicographic term.
 *
 * Parameters:
 * - termCounts: Map<string, number> - frequency map of terms.
 * - limit: number - maximum number of results to return (default 15).
 *
 * Returns: Array<{term: string, count: number}> - sorted top terms.
 */
export function topTermsFromCounts(termCounts: Map<string, number>, limit = 15) {
    return [...termCounts.entries()]
        .sort((l, r) => {
            const d = r[1] - l[1];
            if(d !== 0) {
                return d;
            }
            return l[0].localeCompare(r[0]);
        })
        .slice(0, limit)
        .map(([term, count]) => ({term, count}));
}

/**
 * Build a short preview string from the first few non-empty lines.
 *
 * Behavior:
 * - Skips empty/whitespace-only lines
 * - Joins up to `maxLines` lines with " | " and truncates the result to
 *   `maxLength` characters using `truncate`.
 *
 * Parameters:
 * - lines: string[] - array of file lines
 * - maxLines: number - how many non-empty lines to include (default 3)
 * - maxLength: number - maximum returned character length (default 240)
 *
 * Returns: string - normalized preview text.
 */
export function buildPreviewFromLines(lines: string[], maxLines = 3, maxLength = 240) {
    const previewLines: string[] = [];
    for(const line of lines) {
        const trimmed = line.trim();
        if(!trimmed) {
            continue;
        }
        previewLines.push(trimmed);
        if(previewLines.length >= maxLines) {
            break;
        }
    }
    return truncate(previewLines.join(' | '), maxLength);
}

/**
 * Extract quoted substrings from text (single, double, or backtick quotes).
 *
 * - Only captures quoted parts between 3 and 120 characters long and avoids
 *   spanning newlines.
 * - Returns up to `limit` matches.
 *
 * Parameters:
 * - text: string - input to scan
 * - limit: number - maximum matches to return (default 8)
 *
 * Returns: string[] - array of matched unquoted string contents.
 */
export function extractQuotedStrings(text: string, limit = 8): string[] {
    const matches: string[] = [];
    const pattern = /["'`]([^"'`\n]{3,120})["'`]/g;
    let m: RegExpExecArray | null;
    while((m = pattern.exec(text)) !== null) {
        matches.push(m[1]);
        if(matches.length >= limit) {
            break;
        }
    }
    return matches;
}

/**
 * Compute a coarse bucket key for a term based on its first character.
 *
 * - Lowercase a-z characters are bucketed by their letter.
 * - Leading digits map to 'num'.
 * - Everything else maps to 'other'.
 *
 * This is used to partition postings into multiple files to avoid single
 * huge files for all terms.
 */
export function bucketForTerm(term: string): string {
    const first = term[0] ?? '';
    if(/[a-z]/.test(first)) {
        return first;
    }
    if(/[0-9]/.test(first)) {
        return 'num';
    }
    return 'other';
}

/**
 * Tokenize text into indexable terms.
 *
 * Strategy:
 * - Use a permissive token regex that preserves code-like and path-like tokens.
 * - Emit the normalized base token if useful.
 * - Split on common separators (._:/-) and emit useful parts.
 * - Further split separator parts on CamelCase and emit useful subparts.
 *
 * The result contains many overlapping tokens by design so queries can match
 * whole tokens or components.
 *
 * Parameters:
 * - text: string - input text to tokenize (undefined/null tolerated).
 *
 * Returns: string[] - array of normalized useful tokens.
 */
export function tokenizeText(text: string): string[] {
    const rawTokens = String(text ?? '').match(/[A-Za-z0-9][A-Za-z0-9._:/-]*/g) ?? [];
    const output: string[] = [];

    for(const rawToken of rawTokens) {
        const base = normalizeTerm(rawToken);
        if(isUsefulTerm(base)) {
            output.push(base);
        }

        const separatorParts = rawToken.split(/[._:/-]+/).filter(Boolean);
        for(const separatorPart of separatorParts) {
            const normalizedPart = normalizeTerm(separatorPart);
            if(isUsefulTerm(normalizedPart)) {
                output.push(normalizedPart);
            }

            const camelParts = splitCamelCase(separatorPart);
            for(const camelPart of camelParts) {
                const normalizedCamelPart = normalizeTerm(camelPart);
                if(isUsefulTerm(normalizedCamelPart)) {
                    output.push(normalizedCamelPart);
                }
            }
        }
    }

    return output;
}

