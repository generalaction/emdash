import type { ILink } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { findFileLinks } from '@renderer/lib/pty/file-link-detection';
import {
  ActivationModifierTracker,
  FileLinkProvider,
  isActivationModifierPressed,
} from '@renderer/lib/pty/file-link-provider';

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

  it('does not join backward from the middle of a wrapped line chain', () => {
    const buffer = makeBuffer([
      new MockBufferLine('src/foo/'),
      new MockBufferLine('bar/', true),
      new MockBufferLine('  baz.ts'),
    ]);

    // The bare filename is linked on its own, but it must not be joined backward
    // into the preceding `src/foo/bar/` fragment.
    const links = findFileLinks(buffer, 3);
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe('baz.ts');
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

  it('keeps URL paths delegated to the web links addon', () => {
    const buffer = makeBuffer([new MockBufferLine('see https://example.com/src/file.ts')]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('detects bare filenames without a directory prefix', () => {
    const buffer = makeBuffer([new MockBufferLine('UZH_Silicon_Valley_Attendees_LinkedIn.md')]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 1, y: 1 },
          end: { x: 40, y: 1 },
        },
        text: 'UZH_Silicon_Valley_Attendees_LinkedIn.md',
        isExternal: false,
      },
    ]);
  });

  it('detects a bare filename embedded in a sentence', () => {
    const buffer = makeBuffer([new MockBufferLine('I updated package.json for you')]);

    const links = findFileLinks(buffer, 1);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ text: 'package.json', isExternal: false });
  });

  it('ignores prose abbreviations with single-letter extensions', () => {
    const buffer = makeBuffer([
      new MockBufferLine('e.g. update it, i.e. the file, etc. and the U.S. office'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('ignores version numbers without a file extension', () => {
    const buffer = makeBuffer([new MockBufferLine('upgrade to v1.2.3 today')]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('ignores bare domains and email addresses', () => {
    const buffer = makeBuffer([
      new MockBufferLine('visit example.com or github.com/org/repo, email jane@example.com'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('ignores bare country-code domains in prose', () => {
    const buffer = makeBuffer([
      new MockBufferLine('see paris.fr, hello.de, news.nl, site.ca and foo.it'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('links source files whose extension collides with a country-code TLD', () => {
    const buffer = makeBuffer([new MockBufferLine('open main.rs and build.sh')]);

    expect(findFileLinks(buffer, 1).map((link) => link.text)).toEqual(['main.rs', 'build.sh']);
  });

  it('links single-char extensions only with a directory, not bare', () => {
    const bare = makeBuffer([new MockBufferLine('edit main.c and stdio.h')]);
    expect(findFileLinks(bare, 1)).toEqual([]);

    const withDir = makeBuffer([new MockBufferLine('edit src/main.c now')]);
    expect(findFileLinks(withDir, 1).map((link) => link.text)).toEqual(['src/main.c']);
  });

  it('does not link dotted directory prefixes as bare filenames', () => {
    const buffer = makeBuffer([new MockBufferLine('read docs.v2/README before editing')]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('requires Command on macOS and Control elsewhere', () => {
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(isActivationModifierPressed({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: false }, false)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: true }, true)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: true }, false)).toBe(false);
  });

  it('clears initial underline decorations from mouse events without the modifier', () => {
    const tracker = new ActivationModifierTracker(true);

    expect(tracker.update({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(tracker.decorations()).toEqual({ pointerCursor: true, underline: true });

    expect(tracker.update({ metaKey: false, ctrlKey: false })).toBe(false);
    expect(tracker.decorations()).toEqual({ pointerCursor: false, underline: false });
  });

  it('updates hovered decorations when the modifier changes without mouse movement', () => {
    const tracker = new ActivationModifierTracker(true);
    const decorations = tracker.decorations();

    tracker.hover(decorations, { metaKey: true, ctrlKey: false });
    expect(decorations).toEqual({ pointerCursor: true, underline: true });

    tracker.update({ metaKey: false, ctrlKey: false });
    expect(decorations).toEqual({ pointerCursor: false, underline: false });
  });

  it('repaints the hovered link when the modifier toggles without mouse movement', () => {
    const tracker = new ActivationModifierTracker(true);
    const decorations = tracker.decorations();
    let refreshes = 0;

    tracker.hover(decorations, { metaKey: false, ctrlKey: false }, () => {
      refreshes += 1;
    });
    expect(refreshes).toBe(0);

    tracker.update({ metaKey: true, ctrlKey: false });
    expect(refreshes).toBe(1);

    tracker.update({ metaKey: false, ctrlKey: false });
    expect(refreshes).toBe(2);

    // No change in pressed state must not trigger redundant repaints.
    tracker.update({ metaKey: false, ctrlKey: false });
    expect(refreshes).toBe(2);
  });

  it('stops repainting once the pointer leaves the link', () => {
    const tracker = new ActivationModifierTracker(true);
    const decorations = tracker.decorations();
    let refreshes = 0;

    tracker.hover(decorations, { metaKey: false, ctrlKey: false }, () => {
      refreshes += 1;
    });
    tracker.leave(decorations);

    tracker.update({ metaKey: true, ctrlKey: false });
    expect(refreshes).toBe(0);
  });

  it('only opens links when the activation modifier is pressed', () => {
    const openedFiles: string[] = [];
    const openedExternal: string[] = [];
    const buffer = makeBuffer([new MockBufferLine('open ./src/app.ts and /tmp/report.md')]);
    const provider = new FileLinkProvider(
      { buffer: { active: buffer } } as never,
      (filePath) => openedFiles.push(filePath),
      (filePath) => openedExternal.push(filePath),
      new ActivationModifierTracker(true)
    );

    let links: ILink[] = [];
    provider.provideLinks(1, (providedLinks) => {
      links = providedLinks ?? [];
    });

    const relativeLink = links[0]!;
    relativeLink.activate({ metaKey: false, ctrlKey: false } as MouseEvent, relativeLink.text);
    relativeLink.activate({ metaKey: true, ctrlKey: false } as MouseEvent, relativeLink.text);

    const externalLink = links[1]!;
    externalLink.activate({ metaKey: false, ctrlKey: false } as MouseEvent, externalLink.text);
    externalLink.activate({ metaKey: true, ctrlKey: false } as MouseEvent, externalLink.text);

    expect(openedFiles).toEqual(['src/app.ts']);
    expect(openedExternal).toEqual(['/tmp/report.md']);
  });
});
