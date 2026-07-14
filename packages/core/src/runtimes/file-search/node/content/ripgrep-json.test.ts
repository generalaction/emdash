import { describe, expect, it } from 'vitest';
import { parseRipgrepJsonLine } from './ripgrep-json';

describe('parseRipgrepJsonLine', () => {
  it('converts ripgrep byte offsets into one-based UTF-16 editor columns', () => {
    const prefix = 'const 😀 ';
    const text = `${prefix}VALUE VALUE\r\n`;
    const firstStart = Buffer.byteLength(prefix);
    const secondStart = firstStart + Buffer.byteLength('VALUE ');

    expect(
      parseRipgrepJsonLine(
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: './src/index.ts' },
            lines: { text },
            line_number: 7,
            submatches: [
              { start: firstStart, end: firstStart + 5, match: { text: 'VALUE' } },
              { start: secondStart, end: secondStart + 5, match: { text: 'VALUE' } },
            ],
          },
        })
      )
    ).toEqual({
      path: './src/index.ts',
      lineNumber: 7,
      text: 'const 😀 VALUE VALUE',
      ranges: [
        { startColumn: 10, endColumn: 15 },
        { startColumn: 16, endColumn: 21 },
      ],
    });
  });

  it('supports ripgrep base64 byte payloads and ignores non-match events', () => {
    expect(parseRipgrepJsonLine(JSON.stringify({ type: 'begin', data: {} }))).toBeNull();
    expect(
      parseRipgrepJsonLine(
        JSON.stringify({
          type: 'match',
          data: {
            path: { bytes: Buffer.from('./file.txt').toString('base64') },
            lines: { bytes: Buffer.from('term\n').toString('base64') },
            line_number: 1,
            submatches: [{ start: 0, end: 4, match: { text: 'term' } }],
          },
        })
      )
    ).toMatchObject({ path: './file.txt', text: 'term' });
  });

  it('rejects malformed match records instead of emitting invalid contract data', () => {
    expect(() =>
      parseRipgrepJsonLine(
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: './file.txt' },
            lines: { text: 'term\n' },
            line_number: 1,
            submatches: [{ start: 4, end: 2 }],
          },
        })
      )
    ).toThrow('byte offsets');
  });
});
