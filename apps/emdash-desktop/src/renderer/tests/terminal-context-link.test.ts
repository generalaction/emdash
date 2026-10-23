import { describe, expect, it } from 'vitest';
import { getTerminalLinkAtBufferCell } from '@core/features/terminals/browser/pty/terminal-context-link';

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

describe('terminal context link detection', () => {
  it('resolves file links at the clicked terminal column', () => {
    const buffer = makeBuffer([new MockBufferLine('open ./src/app.ts now')]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 8)).toBe('./src/app.ts');
    expect(getTerminalLinkAtBufferCell(buffer, 1, 5)).toBeNull();
  });

  it('resolves URLs and ignores trailing punctuation', () => {
    const buffer = makeBuffer([new MockBufferLine('see https://example.com/docs, then continue')]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 8)).toBe('https://example.com/docs');
    expect(getTerminalLinkAtBufferCell(buffer, 1, 29)).toBeNull();
  });

  it('uses terminal columns when resolving URLs after wide characters', () => {
    const url = 'https://example.com/docs';
    const cells = [
      { chars: '界', width: 2 },
      { chars: '', width: 0 },
      { chars: ' ', width: 1 },
      ...url.split('').map((chars) => ({ chars, width: 1 })),
      { chars: ',', width: 1 },
    ];
    const buffer = makeBuffer([new MockBufferLine(`界 ${url},`, false, cells)]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 3)).toBeNull();
    expect(getTerminalLinkAtBufferCell(buffer, 1, 4)).toBe(url);
    expect(getTerminalLinkAtBufferCell(buffer, 1, 27)).toBe(url);
    expect(getTerminalLinkAtBufferCell(buffer, 1, 28)).toBeNull();
  });

  it('prefers file links over URL path fragments', () => {
    const buffer = makeBuffer([new MockBufferLine('open /tmp/output/report.md')]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 9)).toBe('/tmp/output/report.md');
  });

  it('resolves a URL split across a soft line break', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Investigate KAI-1044 (https://'),
      new MockBufferLine('linear.app/kairoslive/issue/KAI-1044)', true),
    ]);
    const url = 'https://linear.app/kairoslive/issue/KAI-1044';

    expect(getTerminalLinkAtBufferCell(buffer, 1, 23)).toBe(url);
    expect(getTerminalLinkAtBufferCell(buffer, 2, 1)).toBe(url);
  });

  it.each([
    ['see https://example.com/', '    started successfully', 'https://example.com/'],
    ['see https://example.com/docs.', 'Then continue.', 'https://example.com/docs'],
  ])('keeps Copy Link within the logical line: %s', (first, second, url) => {
    const buffer = makeBuffer([new MockBufferLine(first), new MockBufferLine(second)]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 8)).toBe(url);
    expect(getTerminalLinkAtBufferCell(buffer, 2, 5)).toBeNull();
  });

  it('does not treat the space after a wide character as part of a wrapped URL', () => {
    const first = 'https://example.com/long-';
    const cells = [
      { chars: '界', width: 2 },
      { chars: '', width: 0 },
      { chars: ' ', width: 1 },
      ...first.split('').map((chars) => ({ chars, width: 1 })),
    ];
    const buffer = makeBuffer([
      new MockBufferLine(`界 ${first}`, false, cells),
      new MockBufferLine('path', true),
    ]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 3)).toBeNull();
    expect(getTerminalLinkAtBufferCell(buffer, 1, 4)).toBe('https://example.com/long-path');
  });
});
