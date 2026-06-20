import { describe, expect, it } from 'vitest';
import { getTerminalLinkAtBufferCell } from '@renderer/lib/pty/terminal-context-link';

class MockBufferLine {
  constructor(
    private readonly text: string,
    readonly isWrapped = false
  ) {}

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

  it('prefers file links over URL path fragments', () => {
    const buffer = makeBuffer([new MockBufferLine('open /tmp/output/report.md')]);

    expect(getTerminalLinkAtBufferCell(buffer, 1, 9)).toBe('/tmp/output/report.md');
  });
});
