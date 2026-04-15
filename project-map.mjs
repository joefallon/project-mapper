#!/usr/bin/env node

/**
 * ProjectMap v1
 * -------------
 *
 * A zero-dependency, Node-only, rebuildable project sidecar for large projects.
 *
 * Design goals:
 * - Node built-ins only
 * - No npm dependencies
 * - Works on Windows and Linux
 * - Rebuilds all generated state from scratch
 * - Produces deterministic, queryable project state for large projects
 * - Prefers readability and maintainability over cleverness
 *
 * This script is intentionally heavily commented. The goal is not just to work;
 * the goal is also to remain understandable months later.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * The current working directory is the project root.
 *
 * This keeps the operating model simple:
 * - run the command from the project root
 * - keep .ai/scale under that project root
 * - write generated state under .ai/scale/state
 */
const PROJECT_ROOT = process.cwd();

/**
 * Core filesystem locations used by ProjectMap.
 */
const AI_DIR = path.join(PROJECT_ROOT, '.ai');
const SCALE_DIR = path.join(AI_DIR, 'scale');
const STATE_DIR = path.join(SCALE_DIR, 'state');
const POSTINGS_DIR = path.join(STATE_DIR, 'postings');
const SYNOPSES_DIR = path.join(STATE_DIR, 'synopses');
const SYNOPSES_DIRS_DIR = path.join(SYNOPSES_DIR, 'dirs');
const SYNOPSES_FILES_DIR = path.join(SYNOPSES_DIR, 'files');
const QUERIES_DIR = path.join(STATE_DIR, 'queries');

/**
 * Small version marker for future maintenance.
 *
 * If the on-disk format changes later, this can be incremented and the read-paths
 * can validate against it.
 */
const PROJECT_MAP_VERSION = '1.0.0';

/**
 * Default maximum counts used when returning ranked output.
 *
 * These numbers are intentionally conservative so terminal/browser output stays
 * compact and readable.
 */
const DEFAULT_TOP_FILE_RESULTS = 8;
const DEFAULT_TOP_CHUNK_RESULTS = 12;
const DEFAULT_TOP_RELATED_FILES = 8;
const DEFAULT_TOP_TERMS = 15;
const DEFAULT_TOP_IDENTIFIERS = 12;

/**
 * Default chunk sizing for fallback fixed-window chunking.
 *
 * These values are used when the script cannot detect strong natural section
 * boundaries, or when a natural section becomes very large and needs to be split.
 */
const FALLBACK_CHUNK_LINES = 80;
const FALLBACK_CHUNK_OVERLAP = 20;
const STRUCTURE_MAX_SECTION_LINES = 160;

/**
 * This set controls which directories are ignored during scanning.
 *
 * The goal is not perfect exhaustiveness; the goal is to avoid obvious sources of
 * noise such as generated directories, package caches, and ProjectMap state.
 */
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.obsidian',
  '.cache',
  '.turbo',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'tmp',
  'temp',
  '__pycache__',
]);

/**
 * Additional directory paths, relative to the project root, that should always be
 * ignored. These are expressed in normalized POSIX-style relative paths.
 */
const IGNORED_RELATIVE_DIRECTORIES = new Set([
  '.ai/out',
  '.ai/scale',
  '.ai/scale/state',
]);

/**
 * Common file extensions that are almost always binary or asset-oriented.
 *
 * These files are still counted during scanning, but they are not indexed as text.
 */
const BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.ai', '.avi', '.bin', '.bmp', '.class', '.dll', '.dmg', '.doc',
  '.docx', '.eot', '.exe', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.lib',
  '.lockb', '.mov', '.mp3', '.mp4', '.o', '.obj', '.otf', '.pdf', '.png', '.psd',
  '.so', '.tar', '.tif', '.tiff', '.ttf', '.wav', '.webm', '.webp', '.woff', '.woff2',
  '.xls', '.xlsx', '.zip',
]);

/**
 * Some additional file names/patterns that are usually generated noise.
 */
const GENERATED_FILE_PATTERNS = [
  /\.min\.[^.]+$/i,
  /\.map$/i,
  /package-lock\.json$/i,
  /pnpm-lock\.ya?ml$/i,
  /yarn\.lock$/i,
  /composer\.lock$/i,
  /diff\.diff$/i,
  /Cargo\.lock$/i,
  /poetry\.lock$/i,
];

/**
 * A modest stopword set.
 *
 * This is deliberately small. In mixed code/document repositories it is usually
 * better to preserve more terms than to aggressively strip them.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'if', 'in',
  'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there',
  'these', 'this', 'to', 'was', 'were', 'will', 'with', 'you', 'your', 'we', 'our',
  'can', 'could', 'should', 'would', 'may', 'might', 'not', 'than', 'when', 'where',
  'what', 'which', 'who', 'why', 'how', 'do', 'does', 'did', 'done', 'using', 'use',
  'used', 'via', 'also', 'such', 'only', 'very', 'more', 'most', 'much', 'many',
]);

/**
 * Keywords used to assign coarse file classes.
 *
 * This is intentionally heuristic. The goal is useful retrieval/ranking, not
 * perfect taxonomy.
 */
const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.rst', '.txt', '.adoc']);
const CONFIG_EXTENSIONS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.xml']);
const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.sql']);
const SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.ps1', '.bat', '.cmd']);
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx',
  '.mjs', '.php', '.pl', '.py', '.rb', '.rs', '.scss', '.sass', '.ts', '.tsx', '.vue',
]);
const TEST_HINTS = ['test', 'tests', 'spec', '__tests__', '.spec.', '.test.'];
const DOC_HINTS = ['docs', 'doc', 'readme', 'guide', 'manual', 'notes', 'design', 'lore', 'campaign', 'adventure'];
const CONFIG_HINTS = ['config', 'configs', 'settings'];

/**
 * Declaration-like patterns used during structure-aware chunking.
 *
 * These are still intentionally broad and heuristic.
 */
const DECLARATION_PATTERNS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_]/,
  /^\s*(?:public\s+|private\s+|protected\s+)?function\s+[A-Za-z_]/i,
  /^\s*class\s+[A-Za-z_]/,
  /^\s*(?:interface|enum|namespace|module|trait)\s+[A-Za-z_]/i,
  /^\s*(?:def|fn)\s+[A-Za-z_]/,
  /^\s*(?:describe|it|test)\s*\(/,
  /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*$/,
];

/**
 * Section marker patterns used during structure-aware chunking.
 */
const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+)$/;
const UNDERLINE_HEADING_PATTERN = /^\s*(?:={3,}|-{3,})\s*$/;
const INI_SECTION_PATTERN = /^\s*\[[^\]]+\]\s*$/;
const DELIMITER_PATTERN = /^\s*[-=*#_]{4,}\s*$/;
const FENCE_PATTERN = /^\s*```/;
const HTML_HEADING_PATTERN = /^\s*<h[1-6][^>]*>(.*?)<\/h[1-6]>\s*$/i;

/**
 * Helper used to ensure all persisted relative paths are normalized with forward
 * slashes, even on Windows.
 */
// function toPosixPath(inputPath) {
//   return inputPath.split(path.sep).join('/');
// }

/**
 * Helper that returns a normalized relative path from the project root.
 */
function toRelativeProjectPath(absolutePath) {
  const relative = path.relative(PROJECT_ROOT, absolutePath);
  return toPosixPath(relative || '.');
}

/**
 * Helper that checks whether a string is non-empty after trimming.
 */
// function hasText(value) {
//   return typeof value === 'string' && value.trim().length > 0;
// }

/**
 * Helper that limits string length without throwing away the whole value.
 */
// function truncate(value, maxLength = 240) {
//   if (!hasText(value)) {
//     return '';
//   }
//
//   return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
// }

/**
 * Helper used to create safe filesystem names for generated query artifacts.
 */
// function safeSlug(value, fallback = 'query') {
//   const cleaned = String(value ?? '')
//     .trim()
//     .toLowerCase()
//     .replace(/[^a-z0-9._-]+/g, '-')
//     .replace(/^-+|-+$/g, '')
//     .replace(/-{2,}/g, '-');
//
//   return cleaned || fallback;
// }

/**
 * Helper used to compute a first-character postings bucket.
 *
 * Terms are bucketed by leading character so we avoid one huge postings file.
 */
// function bucketForTerm(term) {
//   const first = term[0] ?? '';
//
//   if (/[a-z]/.test(first)) {
//     return first;
//   }
//
//   if (/[0-9]/.test(first)) {
//     return 'num';
//   }
//
//   return 'other';
// }

/**
 * Stable JSON stringify helper.
 *
 * This keeps persisted JSON output tidy and human-readable.
 */
function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * Minimal helper for writing JSON files.
 */
async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${prettyJson(value)}${os.EOL}`, 'utf8');
}

/**
 * Minimal helper for writing newline-delimited JSON.
 */
async function writeJsonLines(filePath, records) {
  const content = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(filePath, content.length > 0 ? `${content}\n` : '', 'utf8');
}

/**
 * Minimal helper for reading a JSON file.
 */
async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

/**
 * Minimal helper for reading newline-delimited JSON.
 */
async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, 'utf8');

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Simple helper that removes a directory tree if it exists.
 */
async function removeDirectoryIfPresent(directoryPath) {
  await fs.rm(directoryPath, { recursive: true, force: true });
}

/**
 * Ensures all generated-state directories exist.
 */
async function ensureStateDirectories() {
  await fs.mkdir(POSTINGS_DIR, { recursive: true });
  await fs.mkdir(SYNOPSES_DIRS_DIR, { recursive: true });
  await fs.mkdir(SYNOPSES_FILES_DIR, { recursive: true });
  await fs.mkdir(QUERIES_DIR, { recursive: true });
}

/**
 * This helper ensures .ai/scale exists before build output is written.
 *
 * It is intentionally permissive. If the user has not created .ai/scale yet, the
 * build can still create it.
 */
async function ensureScaleDirectory() {
  await fs.mkdir(SCALE_DIR, { recursive: true });
}

/**
 * Reads a file as a short binary sample. Used for binary/text detection.
 */
async function readBinarySample(filePath, maxBytes = 4096) {
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Returns true when a relative path is under a specifically ignored relative
 * directory such as .ai/scale/state.
 */
function isUnderIgnoredRelativeDirectory(relativePath) {
  const normalized = relativePath === '.' ? '.' : relativePath.replace(/^\.\//, '');

  for (const ignoredDirectory of IGNORED_RELATIVE_DIRECTORIES) {
    if (normalized === ignoredDirectory || normalized.startsWith(`${ignoredDirectory}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether a directory should be ignored.
 */
function shouldIgnoreDirectory(relativeDirectoryPath, directoryName) {
  if (IGNORED_DIRECTORY_NAMES.has(directoryName)) {
    return true;
  }

  return isUnderIgnoredRelativeDirectory(relativeDirectoryPath);
}

/**
 * Determines whether a file path looks generated or otherwise undesirable for
 * indexing.
 */
function looksGenerated(relativeFilePath) {
  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(relativeFilePath));
}

/**
 * Returns a coarse file class from the path/extension.
 */
function classifyFile(relativeFilePath, extension, isTextFile) {
  const lowerPath = relativeFilePath.toLowerCase();

  if (!isTextFile) {
    return 'binary';
  }

  if (looksGenerated(relativeFilePath)) {
    return 'generated';
  }

  if (TEST_HINTS.some((hint) => lowerPath.includes(hint))) {
    return 'test';
  }

  if (DOC_EXTENSIONS.has(extension) || DOC_HINTS.some((hint) => lowerPath.includes(hint))) {
    return 'doc';
  }

  if (CONFIG_EXTENSIONS.has(extension) || CONFIG_HINTS.some((hint) => lowerPath.includes(hint))) {
    return 'config';
  }

  if (DATA_EXTENSIONS.has(extension)) {
    return 'data';
  }

  if (SCRIPT_EXTENSIONS.has(extension)) {
    return 'script';
  }

  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }

  if (extension && !isTextFile) {
    return 'asset';
  }

  return isTextFile ? 'unknown' : 'asset';
}

/**
 * Determines whether a file should be treated as binary/non-indexable.
 *
 * Strategy:
 * - obvious binary extension -> binary
 * - otherwise sample the bytes
 * - null bytes or a large ratio of disallowed control bytes -> binary
 */
async function isTextFile(filePath, extension) {
  if (BINARY_EXTENSIONS.has(extension)) {
    return false;
  }

  const sample = await readBinarySample(filePath, 4096);

  if (sample.length === 0) {
    return true;
  }

  let nullByteCount = 0;
  let suspiciousControlCount = 0;

  for (const byte of sample) {
    if (byte === 0) {
      nullByteCount += 1;
      continue;
    }

    const isTab = byte === 9;
    const isLineFeed = byte === 10;
    const isCarriageReturn = byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;

    if (!isTab && !isLineFeed && !isCarriageReturn && !isPrintableAscii) {
      suspiciousControlCount += 1;
    }
  }

  if (nullByteCount > 0) {
    return false;
  }

  const suspiciousRatio = suspiciousControlCount / sample.length;
  return suspiciousRatio < 0.25;
}

/**
 * Normalizes text for easier searching and scoring.
 */
// function normalizeWhitespace(value) {
//   return String(value ?? '').replace(/\s+/g, ' ').trim();
// }

/**
 * Splits CamelCase/PascalCase tokens into smaller parts.
 *
 * Example:
 *   SalesOrderView -> [Sales, Order, View]
 */
// function splitCamelCase(token) {
//   return token
//     .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
//     .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
//     .split(/\s+/)
//     .filter(Boolean);
// }

/**
 * Normalizes a candidate term for indexing.
 */
// function normalizeTerm(term) {
//   return term.toLowerCase().replace(/^[-_.:/]+|[-_.:/]+$/g, '');
// }

/**
 * Returns true for terms we want to keep in the index.
 */
// function isUsefulTerm(term) {
//   if (!term || term.length < 2) {
//     return false;
//   }
//
//   if (STOPWORDS.has(term)) {
//     return false;
//   }
//
//   if (/^\d+$/.test(term) && term.length < 4) {
//     return false;
//   }
//
//   return true;
// }

/**
 * Tokenizes text into indexable terms.
 *
 * This tokenizer is intentionally permissive. It preserves code-ish and path-ish
 * tokens, then also emits subparts so that queries can match either the full token
 * or its components.
 */
// function tokenizeText(text) {
//   const rawTokens = String(text ?? '').match(/[A-Za-z0-9][A-Za-z0-9._:/-]*/g) ?? [];
//   const output = [];
//
//   for (const rawToken of rawTokens) {
//     const base = normalizeTerm(rawToken);
//
//     if (isUsefulTerm(base)) {
//       output.push(base);
//     }
//
//     const separatorParts = rawToken.split(/[._:/-]+/).filter(Boolean);
//
//     for (const separatorPart of separatorParts) {
//       const normalizedPart = normalizeTerm(separatorPart);
//
//       if (isUsefulTerm(normalizedPart)) {
//         output.push(normalizedPart);
//       }
//
//       const camelParts = splitCamelCase(separatorPart);
//
//       for (const camelPart of camelParts) {
//         const normalizedCamelPart = normalizeTerm(camelPart);
//
//         if (isUsefulTerm(normalizedCamelPart)) {
//           output.push(normalizedCamelPart);
//         }
//       }
//     }
//   }
//
//   return output;
// }

/**
 * Builds a frequency map from an array of terms.
 */
// function countTerms(terms) {
//   const counts = new Map();
//
//   for (const term of terms) {
//     counts.set(term, (counts.get(term) ?? 0) + 1);
//   }
//
//   return counts;
// }

/**
 * Returns the top-N items from a term-count map.
 */
// function topTermsFromCounts(termCounts, limit = DEFAULT_TOP_TERMS) {
//   return [...termCounts.entries()]
//     .sort((left, right) => {
//       const countDelta = right[1] - left[1];
//       if (countDelta !== 0) {
//         return countDelta;
//       }
//
//       return left[0].localeCompare(right[0]);
//     })
//     .slice(0, limit)
//     .map(([term, count]) => ({ term, count }));
// }

/**
 * Extracts identifier-like tokens for display/ranking.
 */
// function extractIdentifiers(text) {
//   const matches = String(text ?? '').match(/[A-Za-z_][A-Za-z0-9_:-]{2,}/g) ?? [];
//   const counts = new Map();
//
//   for (const match of matches) {
//     const looksAllLower = /^[a-z0-9_:-]+$/.test(match);
//     const looksCommonWord = STOPWORDS.has(match.toLowerCase());
//
//     if (looksAllLower && looksCommonWord) {
//       continue;
//     }
//
//     counts.set(match, (counts.get(match) ?? 0) + 1);
//   }
//
//   return [...counts.entries()]
//     .sort((left, right) => {
//       const countDelta = right[1] - left[1];
//       if (countDelta !== 0) {
//         return countDelta;
//       }
//
//       return left[0].localeCompare(right[0]);
//     })
//     .slice(0, DEFAULT_TOP_IDENTIFIERS)
//     .map(([identifier, count]) => ({ identifier, count }));
// }

/**
 * Returns a short preview assembled from the first few non-empty lines.
 */
// function buildPreviewFromLines(lines, maxLines = 3, maxLength = 240) {
//   const previewLines = [];
//
//   for (const line of lines) {
//     const trimmed = line.trim();
//
//     if (!trimmed) {
//       continue;
//     }
//
//     previewLines.push(trimmed);
//
//     if (previewLines.length >= maxLines) {
//       break;
//     }
//   }
//
//   return truncate(previewLines.join(' | '), maxLength);
// }

/**
 * Attempts to infer a title for a chunk boundary line.
 */
function inferBoundaryTitle(lines, startIndex) {
  const line = lines[startIndex] ?? '';
  const markdownMatch = line.match(MARKDOWN_HEADING_PATTERN);

  if (markdownMatch) {
    return normalizeWhitespace(markdownMatch[1]);
  }

  const htmlMatch = line.match(HTML_HEADING_PATTERN);
  if (htmlMatch) {
    return normalizeWhitespace(htmlMatch[1]);
  }

  if (INI_SECTION_PATTERN.test(line)) {
    return normalizeWhitespace(line.replace(/^\s*\[|\]\s*$/g, ''));
  }

  if (DELIMITER_PATTERN.test(line)) {
    const previousLine = lines[startIndex - 1] ?? '';
    if (hasText(previousLine)) {
      return normalizeWhitespace(previousLine);
    }
  }

  for (const pattern of DECLARATION_PATTERNS) {
    if (pattern.test(line)) {
      return normalizeWhitespace(line);
    }
  }

  return '';
}

/**
 * Attempts to infer a structural boundary kind.
 */
function inferBoundaryKind(lines, startIndex) {
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

/**
 * Finds natural section boundaries for a file.
 *
 * This function intentionally uses broad heuristics that work across code, docs,
 * configs, and mixed-content repositories.
 */
function detectBoundaries(lines) {
  const boundaries = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] ?? '';
    const nextLine = lines[index + 1] ?? '';

    // Markdown/ATX headings such as: ## Heading
    if (MARKDOWN_HEADING_PATTERN.test(currentLine) || HTML_HEADING_PATTERN.test(currentLine)) {
      boundaries.set(index, {
        startLine: index + 1,
        kind: inferBoundaryKind(lines, index),
        title: inferBoundaryTitle(lines, index),
      });
      continue;
    }

    // Underlined headings such as:
    // Heading Text
    // -----------
    if (hasText(currentLine) && UNDERLINE_HEADING_PATTERN.test(nextLine)) {
      boundaries.set(index, {
        startLine: index + 1,
        kind: 'heading',
        title: normalizeWhitespace(currentLine),
      });
      continue;
    }

    // INI/TOML style section markers.
    if (INI_SECTION_PATTERN.test(currentLine)) {
      boundaries.set(index, {
        startLine: index + 1,
        kind: 'section',
        title: inferBoundaryTitle(lines, index),
      });
      continue;
    }

    // Repeated delimiter lines sometimes separate sections in notes/docs.
    if (DELIMITER_PATTERN.test(currentLine)) {
      boundaries.set(index, {
        startLine: index + 1,
        kind: 'delimiter',
        title: inferBoundaryTitle(lines, index),
      });
      continue;
    }

    // Declaration-like lines help split code files without a full parser.
    for (const pattern of DECLARATION_PATTERNS) {
      if (pattern.test(currentLine)) {
        boundaries.set(index, {
          startLine: index + 1,
          kind: 'declaration',
          title: inferBoundaryTitle(lines, index),
        });
        break;
      }
    }
  }

  // Always include the start of the file as a valid chunk boundary.
  if (!boundaries.has(0)) {
    boundaries.set(0, {
      startLine: 1,
      kind: 'window',
      title: '',
    });
  }

  return [...boundaries.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, boundary]) => boundary);
}

/**
 * Splits a large line range into overlapping fixed-size chunks.
 */
function splitLargeRangeIntoWindows(lines, startLine, endLine, inheritedTitle, inheritedKind) {
  const chunks = [];
  const totalLines = endLine - startLine + 1;

  if (totalLines <= STRUCTURE_MAX_SECTION_LINES) {
    chunks.push({
      startLine,
      endLine,
      kind: inheritedKind,
      title: inheritedTitle,
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
      kind: inheritedKind === 'window' ? 'window' : `${inheritedKind}-part`,
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

/**
 * Produces chunk ranges for a file.
 *
 * Strategy:
 * 1. detect natural boundaries
 * 2. turn natural sections into chunks
 * 3. split very large natural sections into overlapping windows
 * 4. if boundaries are too weak, use plain fallback windows instead
 */
function buildChunkRanges(lines) {
  if (lines.length === 0) {
    return [];
  }

  const boundaries = detectBoundaries(lines);

  // If the only boundary is the start of the file, the structure signals are weak.
  // Fall back to fixed-window chunking.
  if (boundaries.length <= 1) {
    const fallbackChunks = [];
    let startLine = 1;
    let partIndex = 1;

    while (startLine <= lines.length) {
      const endLine = Math.min(lines.length, startLine + FALLBACK_CHUNK_LINES - 1);
      fallbackChunks.push({
        startLine,
        endLine,
        kind: 'window',
        title: `window ${partIndex}`,
      });

      if (endLine >= lines.length) {
        break;
      }

      startLine = Math.max(endLine - FALLBACK_CHUNK_OVERLAP + 1, startLine + 1);
      partIndex += 1;
    }

    return fallbackChunks;
  }

  const chunkRanges = [];

  for (let index = 0; index < boundaries.length; index += 1) {
    const currentBoundary = boundaries[index];
    const nextBoundary = boundaries[index + 1];
    const startLine = currentBoundary.startLine;
    const endLine = nextBoundary ? nextBoundary.startLine - 1 : lines.length;

    if (startLine > endLine) {
      continue;
    }

    const splitRanges = splitLargeRangeIntoWindows(
      lines,
      startLine,
      endLine,
      currentBoundary.title,
      currentBoundary.kind,
    );

    chunkRanges.push(...splitRanges);
  }

  return chunkRanges;
}

/**
 * Extracts quoted strings that may be useful for display.
 */
// function extractQuotedStrings(text, limit = 8) {
//   const matches = [];
//   const pattern = /["'`]([^"'`\n]{3,120})["'`]/g;
//   let match;
//
//   while ((match = pattern.exec(text)) !== null) {
//     matches.push(match[1]);
//
//     if (matches.length >= limit) {
//       break;
//     }
//   }
//
//   return matches;
// }

/**
 * Extracts lines that look like keys or labels.
 */
function extractKeyLikeLines(lines, limit = 8) {
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^[A-Za-z0-9 _.-]{2,60}:\s+/.test(trimmed) || /^[A-Za-z0-9_.-]+\s*=\s+/.test(trimmed)) {
      results.push(truncate(trimmed, 160));
    }

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

/**
 * Extracts filename/path references from text where obvious.
 */
function extractReferencedPaths(text, knownBasenamesSet) {
  const matches = String(text ?? '').match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
  const references = [];
  const seen = new Set();

  for (const match of matches) {
    const normalized = match.replace(/^\.\//, '');
    const basename = path.posix.basename(normalized);

    if (knownBasenamesSet && !knownBasenamesSet.has(basename)) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      references.push(normalized);
    }

    if (references.length >= 12) {
      break;
    }
  }

  return references;
}

/**
 * Creates a compact chunk record from a chunk line range.
 */
function buildChunkRecord({
  chunkId,
  fileId,
  relativeFilePath,
  lines,
  startLine,
  endLine,
  kind,
  title,
  knownBasenamesSet,
}) {
  const slice = lines.slice(startLine - 1, endLine);
  const text = slice.join('\n');
  const preview = buildPreviewFromLines(slice);
  const normalizedPreview = normalizeWhitespace(preview);
  const terms = tokenizeText(text);
  const termCounts = countTerms(terms);
  const topTerms = topTermsFromCounts(termCounts, DEFAULT_TOP_TERMS);
  const identifiers = extractIdentifiers(text);
  const keyLikeLines = extractKeyLikeLines(slice);
  const quotedStrings = extractQuotedStrings(text);
  const referencedPaths = extractReferencedPaths(text, knownBasenamesSet);

  return {
    chunk_id: chunkId,
    file_id: fileId,
    path: relativeFilePath,
    start_line: startLine,
    end_line: endLine,
    kind,
    title: title || '',
    preview: normalizedPreview,
    text,
    line_count: endLine - startLine + 1,
    top_terms: topTerms,
    top_identifiers: identifiers,
    key_like_lines: keyLikeLines,
    quoted_strings: quotedStrings,
    referenced_paths: referencedPaths,
  };
}

/**
 * Produces all chunk records for a file.
 */
function chunkTextFile({ fileId, relativeFilePath, text, knownBasenamesSet, chunkIdGenerator }) {
  const lines = text.split(/\r?\n/);
  const chunkRanges = buildChunkRanges(lines);
  const chunks = [];

  for (const chunkRange of chunkRanges) {
    const chunkId = chunkIdGenerator();
    chunks.push(buildChunkRecord({
      chunkId,
      fileId,
      relativeFilePath,
      lines,
      startLine: chunkRange.startLine,
      endLine: chunkRange.endLine,
      kind: chunkRange.kind,
      title: chunkRange.title,
      knownBasenamesSet,
    }));
  }

  return { lines, chunks };
}

/**
 * Utility used during directory aggregation.
 */
function parentDirectoriesForFile(relativeFilePath) {
  const parts = relativeFilePath.split('/');
  parts.pop();

  const directories = ['.'];
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    directories.push(current);
  }

  return directories;
}

/**
 * Creates a new directory accumulator object.
 */
function createDirectoryAccumulator(dirId, dirPath) {
  return {
    dir_id: dirId,
    path: dirPath,
    recursive_file_count: 0,
    indexed_file_count: 0,
    total_size_bytes: 0,
    extension_counts: Object.create(null),
    class_counts: Object.create(null),
    term_counts: new Map(),
    notable_files: [],
  };
}

/**
 * Increments a plain-object counter.
 */
function incrementCounterObject(counterObject, key, incrementBy = 1) {
  counterObject[key] = (counterObject[key] ?? 0) + incrementBy;
}

/**
 * Merges a list of term-count entries into a target Map.
 */
function mergeTopTermsIntoMap(targetMap, topTerms) {
  for (const { term, count } of topTerms) {
    targetMap.set(term, (targetMap.get(term) ?? 0) + count);
  }
}

/**
 * Returns the basename set for all scanned files.
 *
 * This is used to improve lightweight path-reference detection in chunk content.
 */
function buildKnownBasenamesSet(filePaths) {
  const basenames = new Set();

  for (const filePathValue of filePaths) {
    basenames.add(path.posix.basename(filePathValue));
  }

  return basenames;
}

/**
 * Recursively scans the project tree and returns every non-ignored file path.
 *
 * Files are returned in sorted order for deterministic output.
 */
async function collectProjectFiles() {
  const results = [];

  async function walk(absoluteDirectoryPath) {
    const entries = await fs.readdir(absoluteDirectoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absoluteEntryPath = path.join(absoluteDirectoryPath, entry.name);
      const relativeEntryPath = toRelativeProjectPath(absoluteEntryPath);

      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(relativeEntryPath, entry.name)) {
          continue;
        }

        await walk(absoluteEntryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      results.push({
        absolute_path: absoluteEntryPath,
        relative_path: relativeEntryPath,
      });
    }
  }

  await walk(PROJECT_ROOT);
  return results;
}

/**
 * Creates a compact repo-wide terms list by aggregating top file terms.
 */
function buildRepoTopTerms(fileRecords) {
  const termCounts = new Map();

  for (const fileRecord of fileRecords) {
    if (!fileRecord.indexed) {
      continue;
    }

    mergeTopTermsIntoMap(termCounts, fileRecord.top_terms);
  }

  return topTermsFromCounts(termCounts, 30);
}

/**
 * Returns a sorted object representation of counter-like objects.
 */
function sortCounterObject(counterObject, limit = null) {
  const entries = Object.entries(counterObject)
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) {
        return countDelta;
      }

      return left[0].localeCompare(right[0]);
    });

  const limitedEntries = limit == null ? entries : entries.slice(0, limit);
  return Object.fromEntries(limitedEntries);
}

/**
 * Builds directory records after file processing finishes.
 */
function buildDirectoryRecords(fileRecords) {
  const directoryMap = new Map();
  let directoryCounter = 0;

  const getOrCreateDirectory = (dirPath) => {
    if (!directoryMap.has(dirPath)) {
      directoryCounter += 1;
      directoryMap.set(dirPath, createDirectoryAccumulator(`d${String(directoryCounter).padStart(6, '0')}`, dirPath));
    }

    return directoryMap.get(dirPath);
  };

  // Always create the root accumulator.
  getOrCreateDirectory('.');

  for (const fileRecord of fileRecords) {
    const directories = parentDirectoriesForFile(fileRecord.path);

    for (const dirPath of directories) {
      const dirAccumulator = getOrCreateDirectory(dirPath);
      dirAccumulator.recursive_file_count += 1;
      dirAccumulator.total_size_bytes += fileRecord.size_bytes;
      incrementCounterObject(dirAccumulator.extension_counts, fileRecord.extension || '(none)');
      incrementCounterObject(dirAccumulator.class_counts, fileRecord.file_class);

      if (fileRecord.indexed) {
        dirAccumulator.indexed_file_count += 1;
        mergeTopTermsIntoMap(dirAccumulator.term_counts, fileRecord.top_terms);
      }

      // Keep a short list of notable files for the directory synopsis.
      if (dirAccumulator.notable_files.length < 12) {
        dirAccumulator.notable_files.push({
          path: fileRecord.path,
          indexed: fileRecord.indexed,
          file_class: fileRecord.file_class,
          chunk_count: fileRecord.chunk_count,
        });
      }
    }
  }

  const directoryRecords = [...directoryMap.values()]
    .map((directoryRecord) => ({
      dir_id: directoryRecord.dir_id,
      path: directoryRecord.path,
      recursive_file_count: directoryRecord.recursive_file_count,
      indexed_file_count: directoryRecord.indexed_file_count,
      total_size_bytes: directoryRecord.total_size_bytes,
      extension_counts: sortCounterObject(directoryRecord.extension_counts, 15),
      class_counts: sortCounterObject(directoryRecord.class_counts, 15),
      top_terms: topTermsFromCounts(directoryRecord.term_counts, 20),
      notable_files: directoryRecord.notable_files.sort((left, right) => left.path.localeCompare(right.path)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return directoryRecords;
}

/**
 * Builds file-level records from text and chunk data.
 */
function buildIndexedFileRecord({
  fileId,
  relativeFilePath,
  extension,
  sizeBytes,
  mtimeMs,
  fileClass,
  text,
  lines,
  chunks,
}) {
  const fileTermCounts = new Map();
  const titles = [];
  const preview = buildPreviewFromLines(lines);

  for (const chunk of chunks) {
    mergeTopTermsIntoMap(fileTermCounts, chunk.top_terms);

    if (hasText(chunk.title)) {
      titles.push(chunk.title);
    }
  }

  const fileIdentifiers = extractIdentifiers(text);

  return {
    file_id: fileId,
    path: relativeFilePath,
    extension,
    size_bytes: sizeBytes,
    mtime_ms: mtimeMs,
    indexed: true,
    file_class: fileClass,
    line_count: lines.length,
    chunk_count: chunks.length,
    chunk_ids: chunks.map((chunk) => chunk.chunk_id),
    section_titles: [...new Set(titles)].slice(0, 24),
    top_terms: topTermsFromCounts(fileTermCounts, 20),
    top_identifiers: fileIdentifiers,
    preview,
  };
}

/**
 * Builds a non-indexed file record.
 */
function buildSkippedFileRecord({
  fileId,
  relativeFilePath,
  extension,
  sizeBytes,
  mtimeMs,
  fileClass,
  skipReason,
}) {
  return {
    file_id: fileId,
    path: relativeFilePath,
    extension,
    size_bytes: sizeBytes,
    mtime_ms: mtimeMs,
    indexed: false,
    file_class: fileClass,
    line_count: 0,
    chunk_count: 0,
    chunk_ids: [],
    section_titles: [],
    top_terms: [],
    top_identifiers: [],
    preview: '',
    skip_reason: skipReason,
  };
}

/**
 * Stores postings in memory during build.
 *
 * Structure:
 *   bucket -> term -> array of { chunk_id, tf }
 */
function createPostingsAccumulator() {
  return new Map();
}

/**
 * Adds a chunk's term counts into the postings accumulator.
 */
function addChunkToPostings(postings, chunkRecord) {
  // The top_terms list is intentionally truncated for display and synopsis purposes,
  // but postings should be built from the full chunk text. Re-tokenize here.
  const fullCounts = countTerms(tokenizeText(chunkRecord.text));

  for (const [term, tf] of fullCounts.entries()) {
    const bucket = bucketForTerm(term);

    if (!postings.has(bucket)) {
      postings.set(bucket, new Map());
    }

    const bucketMap = postings.get(bucket);

    if (!bucketMap.has(term)) {
      bucketMap.set(term, []);
    }

    bucketMap.get(term).push({ chunk_id: chunkRecord.chunk_id, tf });
  }
}

/**
 * Writes postings bucket files.
 */
async function persistPostings(postings) {
  for (const [bucket, bucketMap] of postings.entries()) {
    const bucketObject = {};
    const sortedTerms = [...bucketMap.keys()].sort((left, right) => left.localeCompare(right));

    for (const term of sortedTerms) {
      bucketObject[term] = bucketMap.get(term);
    }

    await writeJson(path.join(POSTINGS_DIR, `${bucket}.json`), bucketObject);
  }
}

/**
 * Writes per-file and per-directory synopsis files.
 */
async function persistSynopses({ repoSynopsis, directoryRecords, fileRecords }) {
  await writeJson(path.join(SYNOPSES_DIR, 'repo.json'), repoSynopsis);

  for (const directoryRecord of directoryRecords) {
    await writeJson(path.join(SYNOPSES_DIRS_DIR, `${directoryRecord.dir_id}.json`), directoryRecord);
  }

  for (const fileRecord of fileRecords) {
    await writeJson(path.join(SYNOPSES_FILES_DIR, `${fileRecord.file_id}.json`), fileRecord);
  }
}

/**
 * Builds the entire state directory from scratch.
 */
async function runBuild() {
  await ensureScaleDirectory();

  // Per the agreed operating model, build deletes existing state first and treats
  // any failed partial rebuild as unusable.
  await removeDirectoryIfPresent(STATE_DIR);
  await ensureStateDirectories();

  const buildStartedAt = new Date().toISOString();
  const discoveredFiles = await collectProjectFiles();
  const knownBasenamesSet = buildKnownBasenamesSet(discoveredFiles.map((file) => file.relative_path));

  const fileRecords = [];
  const chunkRecords = [];
  const postings = createPostingsAccumulator();

  let indexedTextFiles = 0;
  let skippedFiles = 0;
  let binaryFiles = 0;
  let generatedFiles = 0;
  let fileCounter = 0;
  let chunkCounter = 0;

  const nextFileId = () => {
    fileCounter += 1;
    return `f${String(fileCounter).padStart(6, '0')}`;
  };

  const nextChunkId = () => {
    chunkCounter += 1;
    return `c${String(chunkCounter).padStart(7, '0')}`;
  };

  for (const discoveredFile of discoveredFiles) {
    const stats = await fs.stat(discoveredFile.absolute_path);
    const extension = path.extname(discoveredFile.relative_path).toLowerCase();
    const textFile = await isTextFile(discoveredFile.absolute_path, extension);
    const fileClass = classifyFile(discoveredFile.relative_path, extension, textFile);
    const fileId = nextFileId();

    // Generated and binary files are counted but not indexed.
    if (!textFile) {
      binaryFiles += 1;
      skippedFiles += 1;
      fileRecords.push(buildSkippedFileRecord({
        fileId,
        relativeFilePath: discoveredFile.relative_path,
        extension,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        fileClass,
        skipReason: 'binary-or-asset',
      }));
      continue;
    }

    if (looksGenerated(discoveredFile.relative_path)) {
      generatedFiles += 1;
      skippedFiles += 1;
      fileRecords.push(buildSkippedFileRecord({
        fileId,
        relativeFilePath: discoveredFile.relative_path,
        extension,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        fileClass,
        skipReason: 'generated-noise',
      }));
      continue;
    }

    const text = await fs.readFile(discoveredFile.absolute_path, 'utf8');
    const { lines, chunks } = chunkTextFile({
      fileId,
      relativeFilePath: discoveredFile.relative_path,
      text,
      knownBasenamesSet,
      chunkIdGenerator: nextChunkId,
    });

    for (const chunk of chunks) {
      addChunkToPostings(postings, chunk);
      chunkRecords.push(chunk);
    }

    fileRecords.push(buildIndexedFileRecord({
      fileId,
      relativeFilePath: discoveredFile.relative_path,
      extension,
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      fileClass,
      text,
      lines,
      chunks,
    }));

    indexedTextFiles += 1;
  }

  const directoryRecords = buildDirectoryRecords(fileRecords);

  const extensionCounts = {};
  const classCounts = {};

  for (const fileRecord of fileRecords) {
    incrementCounterObject(extensionCounts, fileRecord.extension || '(none)');
    incrementCounterObject(classCounts, fileRecord.file_class);
  }

  const repoSynopsis = {
    project_root: PROJECT_ROOT,
    project_root_relative_hint: '.',
    built_at: new Date().toISOString(),
    version: PROJECT_MAP_VERSION,
    total_files_seen: fileRecords.length,
    indexed_text_files: indexedTextFiles,
    skipped_files: skippedFiles,
    binary_files: binaryFiles,
    generated_files_skipped: generatedFiles,
    total_chunks: chunkRecords.length,
    major_extensions: sortCounterObject(extensionCounts, 20),
    major_file_classes: sortCounterObject(classCounts, 20),
    top_terms: buildRepoTopTerms(fileRecords),
    largest_indexed_text_files: fileRecords
      .filter((fileRecord) => fileRecord.indexed)
      .sort((left, right) => right.size_bytes - left.size_bytes)
      .slice(0, 20)
      .map((fileRecord) => ({
        path: fileRecord.path,
        size_bytes: fileRecord.size_bytes,
        chunk_count: fileRecord.chunk_count,
        file_class: fileRecord.file_class,
      })),
    major_directories: directoryRecords
      .filter((directoryRecord) => directoryRecord.path !== '.')
      .sort((left, right) => right.recursive_file_count - left.recursive_file_count || left.path.localeCompare(right.path))
      .slice(0, 20)
      .map((directoryRecord) => ({
        path: directoryRecord.path,
        recursive_file_count: directoryRecord.recursive_file_count,
        indexed_file_count: directoryRecord.indexed_file_count,
      })),
  };

  const buildInfo = {
    version: PROJECT_MAP_VERSION,
    build_started_at: buildStartedAt,
    build_finished_at: new Date().toISOString(),
    project_root: PROJECT_ROOT,
    total_files_seen: fileRecords.length,
    indexed_text_files: indexedTextFiles,
    skipped_files: skippedFiles,
    total_chunks: chunkRecords.length,
  };

  await writeJson(path.join(STATE_DIR, 'build.json'), buildInfo);
  await writeJson(path.join(STATE_DIR, 'repo.json'), repoSynopsis);
  await writeJsonLines(path.join(STATE_DIR, 'dirs.jsonl'), directoryRecords);
  await writeJsonLines(path.join(STATE_DIR, 'files.jsonl'), fileRecords);
  await writeJsonLines(path.join(STATE_DIR, 'chunks.jsonl'), chunkRecords);
  await persistPostings(postings);
  await persistSynopses({ repoSynopsis, directoryRecords, fileRecords });

  printBuildSummary(buildInfo, repoSynopsis);
}

/**
 * Prints a compact build summary to stdout.
 */
function printBuildSummary(buildInfo, repoSynopsis) {
  console.log('PROJECT MAP BUILD COMPLETE');
  console.log(`version: ${buildInfo.version}`);
  console.log(`project_root: ${buildInfo.project_root}`);
  console.log(`built_at: ${buildInfo.build_finished_at}`);
  console.log(`total_files_seen: ${buildInfo.total_files_seen}`);
  console.log(`indexed_text_files: ${buildInfo.indexed_text_files}`);
  console.log(`skipped_files: ${buildInfo.skipped_files}`);
  console.log(`total_chunks: ${buildInfo.total_chunks}`);
  console.log('');
  console.log('TOP DIRECTORIES');

  for (const directory of repoSynopsis.major_directories.slice(0, 10)) {
    console.log(`- ${directory.path} (files=${directory.recursive_file_count}, indexed=${directory.indexed_file_count})`);
  }
}

/**
 * Ensures the generated state exists before read-style commands are used.
 */
async function assertStatePresent() {
  try {
    await fs.access(path.join(STATE_DIR, 'build.json'));
    await fs.access(path.join(STATE_DIR, 'repo.json'));
    await fs.access(path.join(STATE_DIR, 'files.jsonl'));
    await fs.access(path.join(STATE_DIR, 'chunks.jsonl'));
  } catch {
    throw new Error('ProjectMap state is missing or incomplete. Run: node .ai/scale/project-map.mjs build');
  }
}

/**
 * Loads all core state needed for read operations.
 *
 * This intentionally favors simplicity over partial loading. For v1, clarity and
 * maintainability matter more than minimizing memory use.
 */
async function loadCoreState() {
  await assertStatePresent();

  const [buildInfo, repoInfo, fileRecords, chunkRecords, directoryRecords] = await Promise.all([
    readJson(path.join(STATE_DIR, 'build.json')),
    readJson(path.join(STATE_DIR, 'repo.json')),
    readJsonLines(path.join(STATE_DIR, 'files.jsonl')),
    readJsonLines(path.join(STATE_DIR, 'chunks.jsonl')),
    readJsonLines(path.join(STATE_DIR, 'dirs.jsonl')).catch(() => []),
  ]);

  const filesById = new Map();
  const filesByPath = new Map();

  for (const fileRecord of fileRecords) {
    filesById.set(fileRecord.file_id, fileRecord);
    filesByPath.set(fileRecord.path, fileRecord);
  }

  const chunksById = new Map();
  const chunksByFileId = new Map();

  for (const chunkRecord of chunkRecords) {
    chunksById.set(chunkRecord.chunk_id, chunkRecord);

    if (!chunksByFileId.has(chunkRecord.file_id)) {
      chunksByFileId.set(chunkRecord.file_id, []);
    }

    chunksByFileId.get(chunkRecord.file_id).push(chunkRecord);
  }

  const dirsById = new Map();
  const dirsByPath = new Map();

  for (const directoryRecord of directoryRecords) {
    dirsById.set(directoryRecord.dir_id, directoryRecord);
    dirsByPath.set(directoryRecord.path, directoryRecord);
  }

  return {
    buildInfo,
    repoInfo,
    fileRecords,
    chunkRecords,
    directoryRecords,
    filesById,
    filesByPath,
    chunksById,
    chunksByFileId,
    dirsById,
    dirsByPath,
  };
}

/**
 * Loads only the postings buckets necessary for a query.
 */
async function loadRelevantPostings(queryTerms) {
  const bucketsNeeded = [...new Set(queryTerms.map(bucketForTerm))];
  const postings = new Map();

  for (const bucket of bucketsNeeded) {
    const bucketPath = path.join(POSTINGS_DIR, `${bucket}.json`);

    try {
      const bucketData = await readJson(bucketPath);

      for (const [term, postingEntries] of Object.entries(bucketData)) {
        postings.set(term, postingEntries);
      }
    } catch {
      // Missing bucket files are acceptable. It simply means there were no indexed
      // terms in that bucket during build.
    }
  }

  return postings;
}

/**
 * Normalizes a query into a term list suitable for postings lookup.
 */
function normalizeQuery(query) {
  const normalizedQueryText = normalizeWhitespace(String(query ?? ''));
  const queryTerms = [...new Set(tokenizeText(normalizedQueryText))];
  return {
    original: String(query ?? ''),
    normalized_text: normalizedQueryText,
    terms: queryTerms,
  };
}

/**
 * Scores a chunk for a particular query.
 *
 * The scoring model is intentionally heuristic and readable. v1 does not try to be
 * mathematically perfect. It tries to be stable, understandable, and useful.
 */
function scoreChunkForQuery({ chunkRecord, fileRecord, query, postingsByTerm }) {
  let score = 0;
  const reasons = [];
  const matchedTerms = [];
  const chunkTextLower = chunkRecord.text.toLowerCase();
  const chunkTitleLower = chunkRecord.title.toLowerCase();
  const filePathLower = fileRecord.path.toLowerCase();

  for (const term of query.terms) {
    const postingEntries = postingsByTerm.get(term) ?? [];
    const matchingPosting = postingEntries.find((entry) => entry.chunk_id === chunkRecord.chunk_id);

    if (!matchingPosting) {
      continue;
    }

    matchedTerms.push(term);
    score += 3;
    score += Math.min(6, Math.log2(matchingPosting.tf + 1) * 2);
  }

  if (matchedTerms.length > 0) {
    reasons.push(`matched ${matchedTerms.length} query term(s)`);
  }

  if (query.normalized_text && chunkTextLower.includes(query.normalized_text.toLowerCase())) {
    score += 10;
    reasons.push('exact phrase match');
  }

  if (hasText(chunkRecord.title) && query.terms.some((term) => chunkTitleLower.includes(term))) {
    score += 6;
    reasons.push('title/section match');
  }

  if (query.terms.some((term) => filePathLower.includes(term))) {
    score += 5;
    reasons.push('path match');
  }

  if (matchedTerms.length === query.terms.length && query.terms.length > 1) {
    score += 8;
    reasons.push('all query terms present');
  }

  const identifierStrings = (chunkRecord.top_identifiers ?? []).map((item) => item.identifier.toLowerCase());
  if (query.terms.some((term) => identifierStrings.includes(term))) {
    score += 4;
    reasons.push('identifier match');
  }

  // Lightweight domain-sensitive boosts.
  if (fileRecord.file_class === 'test' && query.terms.some((term) => /test|spec/.test(term))) {
    score += 2;
    reasons.push('test-class boost');
  }

  if (fileRecord.file_class === 'doc' && query.terms.some((term) => /room|encounter|guide|manual|docs?|lore|campaign/.test(term))) {
    score += 2;
    reasons.push('doc-class boost');
  }

  if (fileRecord.file_class === 'config' && query.terms.some((term) => /config|setting|env|yaml|json/.test(term))) {
    score += 2;
    reasons.push('config-class boost');
  }

  // Favor slightly denser chunks when the same number of terms matched.
  const density = matchedTerms.length / Math.max(1, chunkRecord.line_count);
  score += density * 10;

  return {
    chunk_id: chunkRecord.chunk_id,
    file_id: fileRecord.file_id,
    path: fileRecord.path,
    title: chunkRecord.title,
    kind: chunkRecord.kind,
    start_line: chunkRecord.start_line,
    end_line: chunkRecord.end_line,
    preview: chunkRecord.preview,
    matched_terms: matchedTerms,
    score,
    reasons: [...new Set(reasons)],
  };
}

/**
 * Executes a query over the current project map and returns ranked chunk/file data.
 */
async function runQuery(queryText) {
  const state = await loadCoreState();
  const query = normalizeQuery(queryText);

  if (query.terms.length === 0) {
    return {
      state,
      query,
      topChunks: [],
      topFiles: [],
      relatedFiles: [],
    };
  }

  const postings = await loadRelevantPostings(query.terms);
  const postingsByTerm = new Map();
  const candidateChunkIds = new Set();

  for (const term of query.terms) {
    const postingEntries = postings.get(term) ?? [];
    postingsByTerm.set(term, postingEntries);

    for (const entry of postingEntries) {
      candidateChunkIds.add(entry.chunk_id);
    }
  }

  const chunkScores = [];

  for (const chunkId of candidateChunkIds) {
    const chunkRecord = state.chunksById.get(chunkId);

    if (!chunkRecord) {
      continue;
    }

    const fileRecord = state.filesById.get(chunkRecord.file_id);

    if (!fileRecord || !fileRecord.indexed) {
      continue;
    }

    const scoredChunk = scoreChunkForQuery({
      chunkRecord,
      fileRecord,
      query,
      postingsByTerm,
    });

    if (scoredChunk.score > 0) {
      chunkScores.push(scoredChunk);
    }
  }

  chunkScores.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.start_line - right.start_line);

  const fileScoresMap = new Map();

  for (const chunkScore of chunkScores) {
    const existing = fileScoresMap.get(chunkScore.file_id) ?? {
      file_id: chunkScore.file_id,
      path: chunkScore.path,
      score: 0,
      reasons: new Set(),
      best_chunks: [],
    };

    // File score is built from its strongest chunks, not every chunk equally.
    existing.best_chunks.push(chunkScore);
    existing.best_chunks.sort((left, right) => right.score - left.score);
    existing.best_chunks = existing.best_chunks.slice(0, 3);
    existing.score = existing.best_chunks.reduce((sum, item) => sum + item.score, 0);

    for (const reason of chunkScore.reasons) {
      existing.reasons.add(reason);
    }

    fileScoresMap.set(chunkScore.file_id, existing);
  }

  const topFiles = [...fileScoresMap.values()]
    .map((fileScore) => {
      const fileRecord = state.filesById.get(fileScore.file_id);
      return {
        file_id: fileScore.file_id,
        path: fileScore.path,
        file_class: fileRecord?.file_class ?? 'unknown',
        chunk_count: fileRecord?.chunk_count ?? 0,
        preview: fileRecord?.preview ?? '',
        score: fileScore.score,
        reasons: [...fileScore.reasons],
        best_chunks: fileScore.best_chunks.map((chunk) => ({
          chunk_id: chunk.chunk_id,
          start_line: chunk.start_line,
          end_line: chunk.end_line,
          title: chunk.title,
          score: chunk.score,
        })),
      };
    })
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  const relatedFiles = findRelatedFiles({
    state,
    topFiles,
    topChunks: chunkScores,
  });

  return {
    state,
    query,
    topChunks: chunkScores.slice(0, DEFAULT_TOP_CHUNK_RESULTS),
    topFiles: topFiles.slice(0, DEFAULT_TOP_FILE_RESULTS),
    relatedFiles,
  };
}

/**
 * Finds related files using a few deterministic signals:
 * - sibling files in the same directory as top hits
 * - files referenced by top chunks when they map to known basenames
 */
function findRelatedFiles({ state, topFiles, topChunks }) {
  const results = [];
  const seen = new Set(topFiles.map((file) => file.path));
  const basenameToFiles = new Map();

  for (const fileRecord of state.fileRecords) {
    const basename = path.posix.basename(fileRecord.path);

    if (!basenameToFiles.has(basename)) {
      basenameToFiles.set(basename, []);
    }

    basenameToFiles.get(basename).push(fileRecord);
  }

  for (const topFile of topFiles.slice(0, 4)) {
    const directory = path.posix.dirname(topFile.path);

    for (const fileRecord of state.fileRecords) {
      if (!fileRecord.indexed) {
        continue;
      }

      if (path.posix.dirname(fileRecord.path) !== directory) {
        continue;
      }

      if (seen.has(fileRecord.path)) {
        continue;
      }

      seen.add(fileRecord.path);
      results.push({
        path: fileRecord.path,
        reason: 'same directory as top hit',
        file_class: fileRecord.file_class,
      });

      if (results.length >= DEFAULT_TOP_RELATED_FILES) {
        return results;
      }
    }
  }

  for (const topChunk of topChunks.slice(0, 6)) {
    const chunkRecord = state.chunksById.get(topChunk.chunk_id);

    if (!chunkRecord) {
      continue;
    }

    for (const reference of chunkRecord.referenced_paths ?? []) {
      const basename = path.posix.basename(reference);
      const matchingFiles = basenameToFiles.get(basename) ?? [];

      for (const matchingFile of matchingFiles) {
        if (!matchingFile.indexed || seen.has(matchingFile.path)) {
          continue;
        }

        seen.add(matchingFile.path);
        results.push({
          path: matchingFile.path,
          reason: `referenced in ${chunkRecord.path}`,
          file_class: matchingFile.file_class,
        });

        if (results.length >= DEFAULT_TOP_RELATED_FILES) {
          return results;
        }
      }
    }
  }

  return results;
}

/**
 * Formats a compact stats report.
 */
async function runStats() {
  const { buildInfo, repoInfo } = await loadCoreState();

  console.log('PROJECT MAP STATS');
  console.log(`version: ${buildInfo.version}`);
  console.log(`project_root: ${repoInfo.project_root}`);
  console.log(`built_at: ${repoInfo.built_at}`);
  console.log(`total_files_seen: ${repoInfo.total_files_seen}`);
  console.log(`indexed_text_files: ${repoInfo.indexed_text_files}`);
  console.log(`skipped_files: ${repoInfo.skipped_files}`);
  console.log(`binary_files: ${repoInfo.binary_files}`);
  console.log(`generated_files_skipped: ${repoInfo.generated_files_skipped}`);
  console.log(`total_chunks: ${repoInfo.total_chunks}`);
  console.log('');

  console.log('MAJOR EXTENSIONS');
  for (const [extension, count] of Object.entries(repoInfo.major_extensions ?? {}).slice(0, 15)) {
    console.log(`- ${extension}: ${count}`);
  }
  console.log('');

  console.log('MAJOR FILE CLASSES');
  for (const [fileClass, count] of Object.entries(repoInfo.major_file_classes ?? {}).slice(0, 15)) {
    console.log(`- ${fileClass}: ${count}`);
  }
  console.log('');

  console.log('MAJOR DIRECTORIES');
  for (const directory of repoInfo.major_directories ?? []) {
    console.log(`- ${directory.path}: files=${directory.recursive_file_count}, indexed=${directory.indexed_file_count}`);
  }
}

/**
 * Persists a query result for optional later inspection.
 */
async function persistQueryArtifact(kind, queryText, payload) {
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${kind}_${safeSlug(queryText)}.json`;
  await writeJson(path.join(QUERIES_DIR, fileName), payload);
}

/**
 * Removes the in-memory state object from a query result before the result is
 * persisted as a query artifact.
 */
function makePersistableQueryResult(result) {
  return {
    query: result.query,
    topFiles: result.topFiles,
    topChunks: result.topChunks,
    relatedFiles: result.relatedFiles,
  };
}

/**
 * Formats and prints a find result.
 */
async function runFind(queryText) {
  const result = await runQuery(queryText);

  console.log(`QUERY: ${result.query.normalized_text || result.query.original}`);
  console.log('');

  console.log('TOP FILES');
  if (result.topFiles.length === 0) {
    console.log('- No matching files found.');
  } else {
    result.topFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file.path}`);
      console.log(`   score: ${file.score.toFixed(2)}`);
      console.log(`   class: ${file.file_class}`);
      console.log(`   why: ${file.reasons.join(' + ') || 'term match'}`);
      if (hasText(file.preview)) {
        console.log(`   preview: ${file.preview}`);
      }
    });
  }

  console.log('');
  console.log('TOP CHUNKS');
  if (result.topChunks.length === 0) {
    console.log('- No matching chunks found.');
  } else {
    result.topChunks.forEach((chunk, index) => {
      console.log(`${index + 1}. [${chunk.chunk_id}] ${chunk.path} lines ${chunk.start_line}-${chunk.end_line}`);
      if (hasText(chunk.title)) {
        console.log(`   title: ${chunk.title}`);
      }
      console.log(`   score: ${chunk.score.toFixed(2)}`);
      console.log(`   why: ${chunk.reasons.join(' + ') || 'term match'}`);
      if (hasText(chunk.preview)) {
        console.log(`   preview: ${chunk.preview}`);
      }
    });
  }

  console.log('');
  console.log('RELATED FILES');
  if (result.relatedFiles.length === 0) {
    console.log('- None.');
  } else {
    for (const relatedFile of result.relatedFiles) {
      console.log(`- ${relatedFile.path} (${relatedFile.reason})`);
    }
  }

  await persistQueryArtifact('find', queryText, makePersistableQueryResult(result));
}

/**
 * Formats and prints an inspect result.
 */
async function runInspect(target) {
  const state = await loadCoreState();

  const byFileId = state.filesById.get(target);
  const byFilePath = state.filesByPath.get(target);
  const byChunkId = state.chunksById.get(target);

  if (byChunkId) {
    const owningFile = state.filesById.get(byChunkId.file_id);

    console.log(`INSPECT: ${target}`);
    console.log(`type: chunk`);
    console.log(`path: ${byChunkId.path}`);
    console.log(`file_id: ${byChunkId.file_id}`);
    console.log(`chunk_id: ${byChunkId.chunk_id}`);
    console.log(`lines: ${byChunkId.start_line}-${byChunkId.end_line}`);
    console.log(`kind: ${byChunkId.kind}`);
    console.log(`title: ${byChunkId.title || '(none)'}`);
    console.log(`file_class: ${owningFile?.file_class ?? 'unknown'}`);
    console.log(`preview: ${byChunkId.preview || '(none)'}`);
    console.log('');
    console.log('TOP TERMS');
    for (const item of byChunkId.top_terms ?? []) {
      console.log(`- ${item.term}: ${item.count}`);
    }
    console.log('');
    console.log('TOP IDENTIFIERS');
    for (const item of byChunkId.top_identifiers ?? []) {
      console.log(`- ${item.identifier}: ${item.count}`);
    }
    console.log('');
    console.log('TEXT');
    console.log(byChunkId.text);
    return;
  }

  const fileRecord = byFileId ?? byFilePath;

  if (!fileRecord) {
    throw new Error(`No file or chunk found for inspect target: ${target}`);
  }

  const fileChunks = state.chunksByFileId.get(fileRecord.file_id) ?? [];

  console.log(`INSPECT: ${target}`);
  console.log(`type: file`);
  console.log(`path: ${fileRecord.path}`);
  console.log(`file_id: ${fileRecord.file_id}`);
  console.log(`class: ${fileRecord.file_class}`);
  console.log(`indexed: ${fileRecord.indexed}`);
  console.log(`extension: ${fileRecord.extension || '(none)'}`);
  console.log(`size_bytes: ${fileRecord.size_bytes}`);
  console.log(`line_count: ${fileRecord.line_count}`);
  console.log(`chunk_count: ${fileRecord.chunk_count}`);
  if (!fileRecord.indexed && fileRecord.skip_reason) {
    console.log(`skip_reason: ${fileRecord.skip_reason}`);
  }
  if (hasText(fileRecord.preview)) {
    console.log(`preview: ${fileRecord.preview}`);
  }
  console.log('');

  console.log('SECTION TITLES');
  if ((fileRecord.section_titles ?? []).length === 0) {
    console.log('- None.');
  } else {
    for (const title of fileRecord.section_titles) {
      console.log(`- ${title}`);
    }
  }
  console.log('');

  console.log('TOP TERMS');
  for (const item of fileRecord.top_terms ?? []) {
    console.log(`- ${item.term}: ${item.count}`);
  }
  console.log('');

  console.log('TOP IDENTIFIERS');
  for (const item of fileRecord.top_identifiers ?? []) {
    console.log(`- ${item.identifier}: ${item.count}`);
  }
  console.log('');

  console.log('CHUNKS');
  if (fileChunks.length === 0) {
    console.log('- None.');
  } else {
    for (const chunk of fileChunks) {
      console.log(`- [${chunk.chunk_id}] lines ${chunk.start_line}-${chunk.end_line} | kind=${chunk.kind}${hasText(chunk.title) ? ` | title=${chunk.title}` : ''}`);
      if (hasText(chunk.preview)) {
        console.log(`  preview: ${chunk.preview}`);
      }
    }
  }
}

/**
 * Formats and prints a task-oriented pack result.
 */
async function runPack(queryText) {
  const result = await runQuery(queryText);

  console.log(`TASK: ${result.query.normalized_text || result.query.original}`);
  console.log('');

  console.log('LIKELY TARGET FILES');
  if (result.topFiles.length === 0) {
    console.log('- No likely target files found.');
  } else {
    result.topFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file.path}`);
      console.log(`   score: ${file.score.toFixed(2)}`);
      console.log(`   class: ${file.file_class}`);
      console.log(`   why: ${file.reasons.join(' + ') || 'term match'}`);
      if (file.best_chunks.length > 0) {
        const strongestChunk = file.best_chunks[0];
        console.log(`   best_section: ${strongestChunk.start_line}-${strongestChunk.end_line}${hasText(strongestChunk.title) ? ` | ${strongestChunk.title}` : ''}`);
      }
    });
  }

  console.log('');
  console.log('LIKELY SECTIONS');
  if (result.topChunks.length === 0) {
    console.log('- No likely sections found.');
  } else {
    result.topChunks.forEach((chunk, index) => {
      console.log(`${index + 1}. [${chunk.chunk_id}] ${chunk.path} lines ${chunk.start_line}-${chunk.end_line}`);
      if (hasText(chunk.title)) {
        console.log(`   title: ${chunk.title}`);
      }
      console.log(`   why: ${chunk.reasons.join(' + ') || 'term match'}`);
      if (hasText(chunk.preview)) {
        console.log(`   preview: ${chunk.preview}`);
      }
    });
  }

  console.log('');
  console.log('RELATED FILES');
  if (result.relatedFiles.length === 0) {
    console.log('- None.');
  } else {
    for (const relatedFile of result.relatedFiles) {
      console.log(`- ${relatedFile.path} (${relatedFile.reason})`);
    }
  }

  console.log('');
  console.log('SUGGESTED NEXT COMMANDS');
  if (result.topFiles.length === 0 && result.topChunks.length === 0) {
    console.log('- node .ai/scale/project-map.mjs stats');
    console.log(`- node .ai/scale/project-map.mjs find ${JSON.stringify(result.query.normalized_text || result.query.original)}`);
  } else {
    const suggestedPaths = new Set();

    for (const chunk of result.topChunks.slice(0, 4)) {
      console.log(`- node .ai/scale/project-map.mjs inspect ${JSON.stringify(chunk.chunk_id)}`);
      suggestedPaths.add(chunk.path);
    }

    for (const file of result.topFiles.slice(0, 3)) {
      if (!suggestedPaths.has(file.path)) {
        console.log(`- node .ai/scale/project-map.mjs inspect ${JSON.stringify(file.path)}`);
      }
    }
  }

  await persistQueryArtifact('pack', queryText, makePersistableQueryResult(result));
}

/**
 * Prints CLI help.
 */
function printHelp() {
  const scriptPath = toPosixPath(path.relative(PROJECT_ROOT, fileURLToPath(import.meta.url)) || '.ai/scale/project-map.mjs');

  console.log('ProjectMap v1');
  console.log('');
  console.log('Usage:');
  console.log(`  node ${scriptPath} <command> [args]`);
  console.log('');
  console.log('Commands:');
  console.log('  build');
  console.log('    Rebuilds .ai/scale/state from scratch.');
  console.log('  stats');
  console.log('    Prints a compact high-level project summary.');
  console.log('  find "<query>"');
  console.log('    Prints ranked candidate files and chunks for a query.');
  console.log('  inspect "<path-or-id>"');
  console.log('    Prints structured details for one file or chunk.');
  console.log('  pack "<task-or-question>"');
  console.log('    Prints a compact investigation packet optimized for browser-based work.');
  console.log('  help');
  console.log('    Prints this help text.');
  console.log('');
  console.log('Examples:');
  console.log(`  node ${scriptPath} build`);
  console.log(`  node ${scriptPath} stats`);
  console.log(`  node ${scriptPath} find "sales order rate retrieval"`);
  console.log(`  node ${scriptPath} inspect "application/controllers/QbeSalesOrderViewController.php"`);
  console.log(`  node ${scriptPath} pack "Where does sales order rate retrieval happen?"`);
}

/**
 * Main CLI dispatcher.
 */
async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'build':
      if (rest.length > 0) {
        throw new Error('The build command does not accept additional arguments.');
      }
      await runBuild();
      break;

    case 'stats':
      if (rest.length > 0) {
        throw new Error('The stats command does not accept additional arguments.');
      }
      await runStats();
      break;

    case 'find': {
      const queryText = rest.join(' ').trim();
      if (!queryText) {
        throw new Error('The find command requires a query string.');
      }
      await runFind(queryText);
      break;
    }

    case 'inspect': {
      const target = rest.join(' ').trim();
      if (!target) {
        throw new Error('The inspect command requires a path or id.');
      }
      await runInspect(target);
      break;
    }

    case 'pack': {
      const queryText = rest.join(' ').trim();
      if (!queryText) {
        throw new Error('The pack command requires a task or question.');
      }
      await runPack(queryText);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Standard top-level error handling.
 *
 * We keep the failure output concise and exit nonzero.
 */
main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
