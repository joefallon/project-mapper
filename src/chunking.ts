/**
 * Port of splitLargeRangeIntoWindows from project-map.mjs
 */

export const FALLBACK_CHUNK_LINES = 80;
export const FALLBACK_CHUNK_OVERLAP = 20;
export const STRUCTURE_MAX_SECTION_LINES = 160;

export interface Chunk {
  startLine: number;
  endLine: number;
  kind: string;
  title: string;
}

export function splitLargeRangeIntoWindows(
  lines: string[],
  startLine: number,
  endLine: number,
  inheritedTitle?: string,
  inheritedKind?: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  const totalLines = endLine - startLine + 1;

  if (totalLines <= STRUCTURE_MAX_SECTION_LINES) {
    chunks.push({
      startLine,
      endLine,
      kind: inheritedKind ?? 'section',
      title: inheritedTitle ?? '',
    });
    return chunks;
  }

  let windowStart = startLine;
  let partIndex = 1;

  while (windowStart <= endLine) {
    const windowEnd = Math.min(endLine, windowStart + FALLBACK_CHUNK_LINES - 1);
    const partTitle = inheritedTitle
      ? `${inheritedTitle} (part ${partIndex})`
      : `window ${partIndex}`;

    chunks.push({
      startLine: windowStart,
      endLine: windowEnd,
      kind: inheritedKind === 'window' ? 'window' : `${inheritedKind ?? 'section'}-part`,
      title: partTitle,
    });

    if (windowEnd >= endLine) {
      break;
    }

    windowStart = Math.max(windowEnd - FALLBACK_CHUNK_OVERLAP + 1, windowStart + 1);
    partIndex += 1;
  }

  return chunks;
}

