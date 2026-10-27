import { describe, expect, it } from 'vitest';
import { findUrlLinks } from '@core/features/terminals/browser/pty/url-link-detection';

type MockCell = {
  chars: string;
  width: number;
};

class MockBufferLine {
  readonly length: number;
  readonly getCell?: (index: number) => { getChars(): string; getWidth(): number } | undefined;

  constructor(
    private readonly text: string,
    readonly isWrapped = false,
    private readonly cells?: MockCell[]
  ) {
    this.length = cells?.length ?? text.length;
    if (cells) {
      this.getCell = (index: number) => {
        const cell = cells[index];
        if (!cell) return undefined;
        return {
          getChars: () => cell.chars,
          getWidth: () => cell.width,
        };
      };
    }
  }

  // Like xterm, trimRight drops only trailing empty cells; printed spaces are content.
  translateToString(trimRight = false): string {
    if (!this.cells) return this.text;
    let end = this.cells.length;
    while (trimRight && end > 0 && this.cells[end - 1]?.chars === '') end -= 1;
    return this.cells
      .slice(0, end)
      .filter((cell) => cell.width > 0)
      .map((cell) => cell.chars || ' ')
      .join('');
  }
}

function cellsFor(text: string): MockCell[] {
  return Array.from(text).flatMap((chars) =>
    /\p{Script=Han}/u.test(chars)
      ? [
          { chars, width: 2 },
          { chars: '', width: 0 },
        ]
      : [{ chars, width: 1 }]
  );
}

function makeBuffer(lines: MockBufferLine[]) {
  return {
    getLine(index: number): MockBufferLine | undefined {
      return lines[index];
    },
  };
}

function softWrap(text: string, width: number): MockBufferLine[] {
  const rows: MockBufferLine[] = [];
  for (let offset = 0; offset < text.length; offset += width) {
    rows.push(new MockBufferLine(text.slice(offset, offset + width), offset > 0));
  }
  return rows;
}

describe('findUrlLinks', () => {
  it('detects a single-line URL and strips trailing punctuation', () => {
    const buffer = makeBuffer([new MockBufferLine('see https://example.com/docs, then continue')]);

    expect(findUrlLinks(buffer, 1)).toEqual([
      {
        range: { start: { x: 5, y: 1 }, end: { x: 28, y: 1 } },
        text: 'https://example.com/docs',
      },
    ]);
  });

  it('joins a URL whose protocol is split by a soft wrap', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Investigate KAI-1044 (https://'),
      new MockBufferLine('linear.app/kairoslive/issue/KAI-1044)', true),
    ]);
    const url = 'https://linear.app/kairoslive/issue/KAI-1044';

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe(url);
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe(url);
  });

  it('joins a URL split by a soft wrap', () => {
    const buffer = makeBuffer([
      new MockBufferLine('see https://example.com/long-'),
      new MockBufferLine('path', true),
    ]);

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com/long-path');
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe('https://example.com/long-path');
  });

  it('does not join a URL to the next sentence', () => {
    const buffer = makeBuffer([
      new MockBufferLine('see https://example.com/path'),
      new MockBufferLine('Status: Todo'),
    ]);

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com/path');
    expect(findUrlLinks(buffer, 2)).toEqual([]);
  });

  it('does not join an indented non-URL line onto a complete URL', () => {
    const buffer = makeBuffer([
      new MockBufferLine('see https://example.com/path'),
      new MockBufferLine('    started successfully'),
    ]);

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com/path');
    expect(findUrlLinks(buffer, 2)).toEqual([]);
  });

  it('resolves a URL from every soft-wrapped continuation row', () => {
    const buffer = makeBuffer([
      new MockBufferLine('https://example.com/'),
      new MockBufferLine('foo/bar/', true),
      new MockBufferLine('baz', true),
    ]);
    const url = 'https://example.com/foo/bar/baz';

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe(url);
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe(url);
    expect(findUrlLinks(buffer, 3)[0]?.text).toBe(url);
  });

  it('keeps separate hard lines separate even when the first URL ends in a slash', () => {
    const buffer = makeBuffer([
      new MockBufferLine('https://example.com/'),
      new MockBufferLine('https://other.example/'),
    ]);
    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com/');
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe('https://other.example/');
  });

  it('preserves a space separating a URL from prose at a soft wrap', () => {
    const buffer = makeBuffer([
      new MockBufferLine('https://example.com/ '),
      new MockBufferLine('started successfully', true),
    ]);
    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com/');
    expect(findUrlLinks(buffer, 2)).toEqual([]);
  });

  it('ignores the empty padding cell left when a wide character soft-wraps', () => {
    const head = 'https://example.com/abc';
    const buffer = makeBuffer([
      new MockBufferLine(head, false, [...cellsFor(head), { chars: '', width: 1 }]),
      new MockBufferLine('界面tail', true, cellsFor('界面tail')),
    ]);
    const link = {
      range: { start: { x: 1, y: 1 }, end: { x: 8, y: 2 } },
      text: 'https://example.com/abc界面tail',
    };

    expect(findUrlLinks(buffer, 1)).toEqual([link]);
    expect(findUrlLinks(buffer, 2)).toEqual([link]);
  });

  it('keeps the closing bracket of an IPv6 host', () => {
    const buffer = makeBuffer([new MockBufferLine('Listening on http://[::1] now')]);
    expect(findUrlLinks(buffer, 1)).toEqual([
      { range: { start: { x: 14, y: 1 }, end: { x: 25, y: 1 } }, text: 'http://[::1]' },
    ]);
  });

  it('finds a short URL after thousands of characters on its soft-wrapped line', () => {
    // 4160 + ' see '.length puts the URL at row 42, columns 66-90.
    const line = `${'x'.repeat(4160)} see https://example.com/short ok`;
    const buffer = makeBuffer(softWrap(line, 100));

    expect(findUrlLinks(buffer, 42)).toEqual([
      {
        range: { start: { x: 66, y: 42 }, end: { x: 90, y: 42 } },
        text: 'https://example.com/short',
      },
    ]);
  });

  it('finds the whole URL or nothing when a URL outruns the scan limit', () => {
    const url = `https://a.example/r?next=${'x'.repeat(4200)}&to=https://b.example/path`;
    const rows = softWrap(url, 100);
    const buffer = makeBuffer(rows);
    const texts = rows.map((_, index) => findUrlLinks(buffer, index + 1).map((link) => link.text));

    // From the first row the scan cannot reach the end, and from the last row it
    // cannot reach the start, where it would otherwise yield https://b.example/path.
    expect(texts[0]).toEqual([]);
    expect(texts[rows.length - 1]).toEqual([]);
    // Middle rows see both ends, so they find the whole URL; no row yields a fragment.
    expect(texts[rows.length >> 1]).toEqual([url]);
    expect(texts.flat().every((text) => text === url)).toBe(true);
  });

  it('does not infer a URL destination from an incomplete hard-wrapped protocol', () => {
    const buffer = makeBuffer([new MockBufferLine('https://'), new MockBufferLine('example.com/')]);
    expect(findUrlLinks(buffer, 1)).toEqual([]);
    expect(findUrlLinks(buffer, 2)).toEqual([]);
  });

  it('maps URL columns through wide characters', () => {
    const url = 'https://example.com/docs';
    const prefix = '界 ';
    const cells = [
      { chars: '界', width: 2 },
      { chars: '', width: 0 },
      { chars: ' ', width: 1 },
      ...url.split('').map((chars) => ({ chars, width: 1 })),
    ];
    const buffer = makeBuffer([new MockBufferLine(`${prefix}${url}`, false, cells)]);
    const match = findUrlLinks(buffer, 1)[0];

    expect(match?.text).toBe(url);
    expect(match?.range.start.x).toBe(4);
    expect(match?.range.end.x).toBe(27);
  });
});
