import type { ILink } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { findFileLinks } from '@renderer/lib/pty/file-link-detection';
import { FileLinkProvider } from '@renderer/lib/pty/file-link-provider';

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

describe('file link provider', () => {
  it('detects one path across wrapped terminal lines', () => {
    const buffer = makeBuffer([
      new MockBufferLine('error in src/renderer/lib/pty/file-link-'),
      new MockBufferLine('provider.ts', true),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 10, y: 1 },
          end: { x: 11, y: 2 },
        },
        text: 'src/renderer/lib/pty/file-link-provider.ts',
        isExternal: false,
      },
    ]);
    expect(findFileLinks(buffer, 2)[0]?.text).toBe('src/renderer/lib/pty/file-link-provider.ts');
  });

  it('detects one path split by adjacent hard line breaks', () => {
    const buffer = makeBuffer([
      new MockBufferLine(
        '  Local agents do not use the terminal shell resolver at all. In src/main/core/'
      ),
      new MockBufferLine(
        '  conversations/impl/local-conversation.ts:140, agent sessions call resolveLocalPtySpawn'
      ),
    ]);

    const expectedFirstLineLink = {
      range: {
        start: { x: 66, y: 1 },
        end: { x: 79, y: 1 },
      },
      text: 'src/main/core/conversations/impl/local-conversation.ts',
      isExternal: false,
    };
    const expectedSecondLineLink = {
      range: {
        start: { x: 3, y: 2 },
        end: { x: 42, y: 2 },
      },
      text: 'src/main/core/conversations/impl/local-conversation.ts',
      isExternal: false,
    };
    expect(findFileLinks(buffer, 1)).toEqual([expectedFirstLineLink]);
    expect(findFileLinks(buffer, 2)).toEqual([expectedSecondLineLink]);
  });

  it('does not join unrelated hard line breaks', () => {
    const buffer = makeBuffer([
      new MockBufferLine('  See src/main/core/'),
      new MockBufferLine('  for more implementation details.'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
    expect(findFileLinks(buffer, 2)).toEqual([]);
  });

  it('does not join backward from the middle of a wrapped line chain when detecting root files', () => {
    const buffer = makeBuffer([
      new MockBufferLine('src/foo/'),
      new MockBufferLine('bar/', true),
      new MockBufferLine('  baz.ts'),
    ]);

    expect(findFileLinks(buffer, 3)).toEqual([
      {
        range: {
          start: { x: 3, y: 3 },
          end: { x: 8, y: 3 },
        },
        text: 'baz.ts',
        isExternal: false,
      },
    ]);
  });

  it('classifies absolute and home-relative paths as external', () => {
    const buffer = makeBuffer([
      new MockBufferLine('open /tmp/output/report.md and ~/notes/todo.md'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 6, y: 1 },
          end: { x: 26, y: 1 },
        },
        text: '/tmp/output/report.md',
        isExternal: true,
      },
      {
        range: {
          start: { x: 32, y: 1 },
          end: { x: 46, y: 1 },
        },
        text: '~/notes/todo.md',
        isExternal: true,
      },
    ]);
  });

  it('detects repository-root file references without a directory segment', () => {
    const buffer = makeBuffer([new MockBufferLine('Updated package.json and vite.config.ts')]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 9, y: 1 },
          end: { x: 20, y: 1 },
        },
        text: 'package.json',
        isExternal: false,
      },
      {
        range: {
          start: { x: 26, y: 1 },
          end: { x: 39, y: 1 },
        },
        text: 'vite.config.ts',
        isExternal: false,
      },
    ]);
  });

  it('keeps URL paths delegated to the web links addon', () => {
    const buffer = makeBuffer([new MockBufferLine('see https://example.com/src/file.ts')]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('does not detect slash-free domains or incidental extension-bearing text', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Visit docs.npmjs.com for more info'),
      new MockBufferLine('Copied to clipboard.ts'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
    expect(findFileLinks(buffer, 2)).toEqual([]);
  });

  it('opens links on normal click', () => {
    const openedFiles: string[] = [];
    const openedExternal: string[] = [];
    const buffer = makeBuffer([new MockBufferLine('open ./src/app.ts and /tmp/report.md')]);
    const provider = new FileLinkProvider(
      { buffer: { active: buffer } } as never,
      (filePath) => openedFiles.push(filePath),
      (filePath) => openedExternal.push(filePath)
    );

    let links: ILink[] = [];
    provider.provideLinks(1, (providedLinks) => {
      links = providedLinks ?? [];
    });

    const relativeLink = links[0]!;
    relativeLink.activate({ metaKey: false, ctrlKey: false } as MouseEvent, relativeLink.text);

    const externalLink = links[1]!;
    externalLink.activate({ metaKey: false, ctrlKey: false } as MouseEvent, externalLink.text);

    expect(openedFiles).toEqual(['src/app.ts']);
    expect(openedExternal).toEqual(['/tmp/report.md']);
  });
});
