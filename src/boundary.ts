/**
 * Ported inferBoundaryKind and related patterns from project-map.mjs
 * Source: project-map.mjs (function inferBoundaryKind around lines ~696-722)
 */

export type BoundaryKind = 'heading' | 'section' | 'delimiter' | 'fence' | 'declaration';

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

  if (MARKDOWN_HEADING_PATTERN.test(line) || HTML_HEADING_PATTERN.test(line)) {
    return 'heading';
  }

  if (INI_SECTION_PATTERN.test(line)) {
    return 'section';
  }

  if (DELIMITER_PATTERN.test(line)) {
    return 'delimiter';
  }

  if (FENCE_PATTERN.test(line)) {
    return 'fence';
  }

  for (const pattern of DECLARATION_PATTERNS) {
    if (pattern.test(line)) {
      return 'declaration';
    }
  }

  return 'section';
}

