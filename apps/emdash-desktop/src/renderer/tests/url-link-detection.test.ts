import { describe, expect, it } from 'vitest';
import {
  copyableTerminalSelection,
  findUrlLinks,
} from '@core/features/terminals/browser/pty/url-link-detection';

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
    cells?: MockCell[]
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

  translateToString(): string {
    return this.text;
  }
}

function makeBuffer(lines: MockBufferLine[]) {
  return {
    getLine(index: number): MockBufferLine | undefined {
      return lines[index];
    },
  };
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

  it('joins a URL split by a TUI hard wrap', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Investigate KAI-1044 (https://'),
      new MockBufferLine('linear.app/kairoslive/issue/KAI-1044)'),
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

  it('resolves a URL from later hard-wrapped continuation rows', () => {
    const buffer = makeBuffer([
      new MockBufferLine('https://example.com/'),
      new MockBufferLine('foo/bar/'),
      new MockBufferLine('baz'),
    ]);
    const url = 'https://example.com/foo/bar/baz';

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe(url);
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe(url);
    expect(findUrlLinks(buffer, 3)[0]?.text).toBe(url);
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

describe('copyableTerminalSelection', () => {
  it('joins a wrapped URL selection', () => {
    expect(copyableTerminalSelection('https://\nlinear.app/kairoslive/issue/KAI-1044)')).toBe(
      'https://linear.app/kairoslive/issue/KAI-1044'
    );
  });

  it('leaves non-URL selections unchanged', () => {
    expect(copyableTerminalSelection('https://example.com/path\nStatus: Todo')).toBe(
      'https://example.com/path\nStatus: Todo'
    );
  });

  it('leaves single-line text unchanged', () => {
    expect(copyableTerminalSelection('https://example.com/path')).toBe('https://example.com/path');
  });

  it('joins a mid-segment hard wrap', () => {
    expect(copyableTerminalSelection('https://example.com/longpat\nh/to/resource')).toBe(
      'https://example.com/longpath/to/resource'
    );
  });
});
