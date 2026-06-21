import fs from 'node:fs/promises';

export type FileLineCountResult = {
  lines: number;
  truncated: boolean;
  totalSize: number;
};

export async function countFileLines(
  filePath: string,
  options: { maxBytes: number }
): Promise<FileLineCountResult> {
  const stat = await fs.stat(filePath);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(options.maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, options.maxBytes + 1, 0);
    const truncated = bytesRead > options.maxBytes;
    const content = buffer.subarray(0, truncated ? options.maxBytes : bytesRead);
    return {
      lines: countLines(content),
      truncated,
      totalSize: stat.size,
    };
  } finally {
    await handle.close();
  }
}

function countLines(content: Buffer): number {
  if (content.length === 0) return 0;

  let lines = 0;
  for (const byte of content) {
    if (byte === 0x0a) lines++;
  }

  if (content[content.length - 1] !== 0x0a) lines++;
  return lines;
}
