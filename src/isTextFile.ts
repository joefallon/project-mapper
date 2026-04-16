import { readBinarySample } from './readBinarySample';
import { BINARY_EXTENSIONS } from './constants';

/**
 * Port of isTextFile from project-map.mjs
 * Determines whether a file should be treated as text (indexable) or binary.
 */
export async function isTextFile(filePath: string, extension: string): Promise<boolean> {
  const ext = String(extension ?? '').toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
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

export default isTextFile;

