import { describe, expect, it } from 'vitest';
import { chunkTerminalInput } from './terminal-input';

describe('chunkTerminalInput', () => {
  it('keeps every chunk within the UTF-8 byte limit without splitting code points', () => {
    const input = `${'a'.repeat(9_000)}${'🙂'.repeat(3_000)}`;
    const chunks = chunkTerminalInput(input);
    const encoder = new TextEncoder();

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((chunk) => encoder.encode(chunk).byteLength <= 8 * 1024)).toBe(true);
  });

  it('rejects an invalid byte limit', () => {
    expect(() => chunkTerminalInput('input', 0)).toThrow('positive integer');
  });
});
