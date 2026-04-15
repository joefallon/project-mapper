export function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function truncate(value: string, maxLength = 240): string {
  if (!hasText(value)) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export function normalizeWhitespace(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function toPosixPath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

export function safeSlug(value: string | undefined, fallback = 'query'): string {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return cleaned || fallback;
}

export function splitCamelCase(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeTerm(term: string): string {
  return String(term ?? '').trim().toLowerCase().replace(/^[-_.:\/]+|[-_.:\/]+$/g, '');
}

export function isUsefulTerm(term: string): boolean {
  if (!term || term.length < 2) return false;
  // minimal stopword set for tests
  const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to']);
  if (STOPWORDS.has(term)) return false;
  if (/^\d+$/.test(term) && term.length < 4) return false;
  return true;
}

export function countTerms(terms: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

export function topTermsFromCounts(termCounts: Map<string, number>, limit = 15) {
  return [...termCounts.entries()]
    .sort((l, r) => {
      const d = r[1] - l[1];
      if (d !== 0) return d;
      return l[0].localeCompare(r[0]);
    })
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

export function buildPreviewFromLines(lines: string[], maxLines = 3, maxLength = 240) {
  const previewLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    previewLines.push(trimmed);
    if (previewLines.length >= maxLines) break;
  }
  return truncate(previewLines.join(' | '), maxLength);
}

export function extractQuotedStrings(text: string, limit = 8): string[] {
  const matches: string[] = [];
  const pattern = /["'`]([^"'`\n]{3,120})["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    matches.push(m[1]);
    if (matches.length >= limit) break;
  }
  return matches;
}

export function bucketForTerm(term: string): string {
  const first = term[0] ?? '';
  if (/[a-z]/.test(first)) return first;
  if (/[0-9]/.test(first)) return 'num';
  return 'other';
}

export function tokenizeText(text: string): string[] {
  const rawTokens = String(text ?? '').match(/[A-Za-z0-9][A-Za-z0-9._:/-]*/g) ?? [];
  const output: string[] = [];

  for (const rawToken of rawTokens) {
    const base = normalizeTerm(rawToken);
    if (isUsefulTerm(base)) output.push(base);

    const separatorParts = rawToken.split(/[._:/-]+/).filter(Boolean);
    for (const separatorPart of separatorParts) {
      const normalizedPart = normalizeTerm(separatorPart);
      if (isUsefulTerm(normalizedPart)) output.push(normalizedPart);

      const camelParts = splitCamelCase(separatorPart);
      for (const camelPart of camelParts) {
        const normalizedCamelPart = normalizeTerm(camelPart);
        if (isUsefulTerm(normalizedCamelPart)) output.push(normalizedCamelPart);
      }
    }
  }

  return output;
}

