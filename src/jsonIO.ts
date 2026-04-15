import fs from 'node:fs/promises';
import os from 'node:os';
import prettyJson from './prettyJson';

/**
 * Minimal helper for writing JSON files (ports behavior from project-map.mjs).
 */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${prettyJson(value)}${os.EOL}`, 'utf8');
}

/**
 * Minimal helper for writing newline-delimited JSON.
 */
export async function writeJsonLines(filePath: string, records: unknown[]): Promise<void> {
  const content = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(filePath, content.length > 0 ? `${content}\n` : '', 'utf8');
}

/**
 * Minimal helper for reading a JSON file.
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

/**
 * Minimal helper for reading newline-delimited JSON.
 */
export async function readJsonLines<T = unknown>(filePath: string): Promise<T[]> {
  const text = await fs.readFile(filePath, 'utf8');

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export default {
  writeJson,
  writeJsonLines,
  readJson,
  readJsonLines,
};

