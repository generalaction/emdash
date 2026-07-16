const terminalInputByteLimit = 8 * 1024;

export function chunkTerminalInput(input: string, maxBytes = terminalInputByteLimit): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('Terminal input chunk size must be a positive integer.');
  }
  if (!input) return [];

  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of input) {
    const characterBytes = encoder.encode(character).byteLength;
    if (characterBytes > maxBytes) {
      throw new RangeError('Terminal input contains a character larger than the chunk limit.');
    }
    if (chunkBytes + characterBytes > maxBytes) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
