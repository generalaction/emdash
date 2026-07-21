import type { ILink } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { findFileLinks } from '@renderer/lib/pty/file-link-detection';
import {
  ActivationModifierTracker,
  FileLinkProvider,
  isActivationModifierPressed,
  isPrimaryMouseButton,
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

    // Only the bare filename on the last line — never the joined path.
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

  it('detects bare filenames without a directory segment', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Search Qin Liu in UZH_Silicon_Valley_Attendees_LinkedIn.md'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 19, y: 1 },
          end: { x: 58, y: 1 },
        },
        text: 'UZH_Silicon_Valley_Attendees_LinkedIn.md',
        isExternal: false,
      },
    ]);
  });

  it('ignores single-letter abbreviations like e.g. and i.e.', () => {
    const buffer = makeBuffer([
      new MockBufferLine('use a helper, e.g. one from utils, i.e. the shared one'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('ignores common framework names that look like bare filenames', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Detected Node.js, React.jsx, Vue.js, and Express.js versions'),
    ]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
  });

  it('still detects pathful filenames that use common framework names', () => {
    const buffer = makeBuffer([new MockBufferLine('open docs/Node.js and examples/React.jsx')]);

    expect(findFileLinks(buffer, 1)).toEqual([
      {
        range: {
          start: { x: 6, y: 1 },
          end: { x: 17, y: 1 },
        },
        text: 'docs/Node.js',
        isExternal: false,
      },
      {
        range: {
          start: { x: 23, y: 1 },
          end: { x: 40, y: 1 },
        },
        text: 'examples/React.jsx',
        isExternal: false,
      },
    ]);
  });

  it('keeps bare domains inside URLs delegated to the web links addon', () => {
    const buffer = makeBuffer([new MockBufferLine('deployed to https://emdash.sh just now')]);

    expect(findFileLinks(buffer, 1)).toEqual([]);
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

  it('requires Command on macOS and Control elsewhere', () => {
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(isActivationModifierPressed({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: false }, false)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: true }, true)).toBe(false);
    expect(isActivationModifierPressed({ metaKey: true, ctrlKey: true }, false)).toBe(false);
  });

  it('only treats the primary mouse button as link activation', () => {
    expect(isPrimaryMouseButton({ button: 0 })).toBe(true);
    expect(isPrimaryMouseButton({ button: 1 })).toBe(false);
    expect(isPrimaryMouseButton({ button: 2 })).toBe(false);
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
    relativeLink.activate(
      { button: 0, metaKey: false, ctrlKey: false } as MouseEvent,
      relativeLink.text
    );
    relativeLink.activate(
      { button: 2, metaKey: true, ctrlKey: false } as MouseEvent,
      relativeLink.text
    );
    relativeLink.activate(
      { button: 0, metaKey: true, ctrlKey: false } as MouseEvent,
      relativeLink.text
    );

    const externalLink = links[1]!;
    externalLink.activate(
      { button: 0, metaKey: false, ctrlKey: false } as MouseEvent,
      externalLink.text
    );
    externalLink.activate(
      { button: 2, metaKey: true, ctrlKey: false } as MouseEvent,
      externalLink.text
    );
    externalLink.activate(
      { button: 0, metaKey: true, ctrlKey: false } as MouseEvent,
      externalLink.text
    );

    expect(openedFiles).toEqual(['src/app.ts']);
    expect(openedExternal).toEqual(['/tmp/report.md']);
  });
});
