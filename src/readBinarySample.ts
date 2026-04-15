import fs from 'node:fs/promises';

/**
 * Reads a file as a short binary sample. Used for binary/text detection.
 *
 * Behavior: open file, read up to `maxBytes` starting at offset 0, return a
 * Buffer containing exactly the bytes read. Always closes the file handle.
 */
export async function readBinarySample(filePath: string, maxBytes = 4096): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export default readBinarySample;

