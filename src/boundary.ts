/**
 * Ported inferBoundaryKind and related patterns from project-map.mjs
 * Source: project-map.mjs (function inferBoundaryKind around lines ~696-722)
 */

import { hasText, normalizeWhitespace } from './utils';

export type BoundaryKind = 'heading' | 'section' | 'delimiter' | 'fence' | 'declaration';

export type Boundary = {
    startLine: number;
    kind: BoundaryKind | 'window';
    title: string;
};

// Declaration-like patterns used during structure-aware chunking (ported)
export const DECLARATION_PATTERNS = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_]/,
    /^\s*(?:public\s+|private\s+|protected\s+)?function\s+[A-Za-z_]/i,
    /^\s*class\s+[A-Za-z_]/,
    /^\s*(?:interface|enum|namespace|module|trait)\s+[A-Za-z_]/i,
    /^\s*(?:def|fn)\s+[A-Za-z_]/,
    /^\s*(?:describe|it|test)\s*\(/,
    /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*$/,
];

// Section marker patterns used during structure-aware chunking (ported)
export const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+)$/;
export const UNDERLINE_HEADING_PATTERN = /^\s*(?:={3,}|-{3,})\s*$/;
export const INI_SECTION_PATTERN = /^\s*\[[^\]]+\]\s*$/;
export const DELIMITER_PATTERN = /^\s*[-=*#_]{4,}\s*$/;
export const FENCE_PATTERN = /^\s*```/;
export const HTML_HEADING_PATTERN = /^\s*<h[1-6][^>]*>(.*?)<\/h[1-6]>\s*$/i;

/**
 * Attempts to infer a structural boundary kind.
 *
 * Behavior mirrors the implementation in project-map.mjs: checks for
 * markdown/html headings, ini sections, delimiter lines, fences, then
 * declaration-like patterns. Falls back to 'section'.
 */
export function inferBoundaryKind(lines: string[], startIndex: number): BoundaryKind {
    const line = lines[startIndex] ?? '';

    if(MARKDOWN_HEADING_PATTERN.test(line) || HTML_HEADING_PATTERN.test(line)) {
        return 'heading';
    }

    if(INI_SECTION_PATTERN.test(line)) {
        return 'section';
    }

    if(DELIMITER_PATTERN.test(line)) {
        return 'delimiter';
    }

    if(FENCE_PATTERN.test(line)) {
        return 'fence';
    }

    for(const pattern of DECLARATION_PATTERNS) {
        if(pattern.test(line)) {
            return 'declaration';
        }
    }

    return 'section';
}


/**
 * Attempts to infer a title for a chunk boundary line.
 *
 * Ported from project-map.mjs inferBoundaryTitle.
 */
export function inferBoundaryTitle(lines: string[], startIndex: number): string {
    const line = lines[startIndex] ?? '';
    const markdownMatch = line.match(MARKDOWN_HEADING_PATTERN);

    if(markdownMatch) {
        return normalizeWhitespace(markdownMatch[1]);
    }

    const htmlMatch = line.match(HTML_HEADING_PATTERN);
    if(htmlMatch) {
        return normalizeWhitespace(htmlMatch[1]);
    }

    if(INI_SECTION_PATTERN.test(line)) {
        return normalizeWhitespace(line.replace(/^\s*\[|\]\s*$/g, ''));
    }

    if(DELIMITER_PATTERN.test(line)) {
        const previousLine = lines[startIndex - 1] ?? '';
        if(hasText(previousLine)) {
            return normalizeWhitespace(previousLine);
        }
    }

    for(const pattern of DECLARATION_PATTERNS) {
        if(pattern.test(line)) {
            return normalizeWhitespace(line);
        }
    }

    return '';
}


/**
 * Finds natural section boundaries for a file.
 *
 * Ported from project-map.mjs detectBoundaries.
 */
export function detectBoundaries(lines: string[]): Boundary[] {
    const boundaries = new Map<number, Boundary>();

    for(let index = 0; index < lines.length; index += 1) {
        const currentLine = lines[index] ?? '';
        const nextLine = lines[index + 1] ?? '';

        // Markdown/ATX headings such as: ## Heading
        if(MARKDOWN_HEADING_PATTERN.test(currentLine) || HTML_HEADING_PATTERN.test(currentLine)) {
            boundaries.set(index, {
                startLine: index + 1,
                kind:      inferBoundaryKind(lines, index),
                title:     inferBoundaryTitle(lines, index),
            });
            continue;
        }

        // Underlined headings such as:
        // Heading Text
        // -----------
        if(hasText(currentLine) && UNDERLINE_HEADING_PATTERN.test(nextLine)) {
            boundaries.set(index, {
                startLine: index + 1,
                kind:      'heading',
                title:     normalizeWhitespace(currentLine),
            });
            continue;
        }

        // INI/TOML style section markers.
        if(INI_SECTION_PATTERN.test(currentLine)) {
            boundaries.set(index, {
                startLine: index + 1,
                kind:      'section',
                title:     inferBoundaryTitle(lines, index),
            });
            continue;
        }

        // Repeated delimiter lines sometimes separate sections in notes/docs.
        if(DELIMITER_PATTERN.test(currentLine)) {
            boundaries.set(index, {
                startLine: index + 1,
                kind:      'delimiter',
                title:     inferBoundaryTitle(lines, index),
            });
            continue;
        }

        // Declaration-like lines help split code files without a full parser.
        for(const pattern of DECLARATION_PATTERNS) {
            if(pattern.test(currentLine)) {
                boundaries.set(index, {
                    startLine: index + 1,
                    kind:      'declaration',
                    title:     inferBoundaryTitle(lines, index),
                });
                break;
            }
        }
    }

    // Always include the start of the file as a valid chunk boundary.
    if(!boundaries.has(0)) {
        boundaries.set(0, {
            startLine: 1,
            kind:      'window',
            title:     '',
        });
    }

    return [...boundaries.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([, boundary]) => boundary);
}



