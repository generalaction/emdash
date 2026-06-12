import type { ILink } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { findFileLinks, findUrlLinks } from '@renderer/lib/pty/file-link-detection';
import {
  ActivationModifierTracker,
  FileLinkProvider,
  isActivationModifierPressed,
} from '@renderer/lib/pty/file-link-provider';

class MockBufferLine {
  constructor(
    private readonly text: string,
    readonly isWrapped = false,
    // Cell width of the row. Defaults to wider than the text so rows do not
    // accidentally count as filled-to-the-last-column in unrelated tests.
    readonly length = 120
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

    expect(findFileLinks(buffer, 3)).toEqual([]);
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

  it('keeps URL paths delegated to the url link provider', () => {
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

describe('url link detection', () => {
  it('detects one URL across soft-wrapped terminal lines', () => {
    const buffer = makeBuffer([
      new MockBufferLine('visit https://example.com/very/long/'),
      new MockBufferLine('path/to/page.html now', true),
    ]);

    const expected = [
      {
        range: {
          start: { x: 7, y: 1 },
          end: { x: 17, y: 2 },
        },
        text: 'https://example.com/very/long/path/to/page.html',
      },
    ];
    expect(findUrlLinks(buffer, 1)).toEqual(expected);
    expect(findUrlLinks(buffer, 2)).toEqual(expected);
  });

  it('joins a bracketed query string split by a hard line break', () => {
    const buffer = makeBuffer([
      new MockBufferLine('open https://example.com/search?'),
      new MockBufferLine('filter[status]=pending&page=2 found it'),
    ]);

    const fullUrl = 'https://example.com/search?filter[status]=pending&page=2';
    expect(findUrlLinks(buffer, 1)[0]?.text).toBe(fullUrl);
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe(fullUrl);
  });

  it('does not join prose lines following a URL', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Visit https://example.com'),
      new MockBufferLine('and then run the tests.'),
    ]);

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com');
    expect(findUrlLinks(buffer, 2)).toEqual([]);
  });

  it('reconstructs an edge-to-edge URL hard-wrapped across many rows from any row', () => {
    const longUrl =
      'https://api.staging-eu-west-1.internal-services.mega-ultra-long-subdomain.beispiel-unternehmen-gmbh-und-co-kg.de/v3/customers/8f4e2a1b-9c7d-4e6f-a3b2-1d5c8e9f0a47/orders/2026/06/12/items?include=shipping,billing,tracking&filter[status]=pending&filter[region]=eu-central&sort=-created_at&page[number]=17&page[size]=50&expand=line_items.product.variants&locale=de-DE&currency=EUR&api_key=demo_pk_51JxK2mNoPqRsTuVwXyZ&signature=a1b2c3d4e5f67890deadbeefcafe1234&timestamp=1718203947#section-tracking-details';
    const cols = 96;
    const rows: MockBufferLine[] = [];
    for (let offset = 0; offset < longUrl.length; offset += cols) {
      rows.push(new MockBufferLine(longUrl.slice(offset, offset + cols), false, cols));
    }
    const buffer = makeBuffer(rows);

    expect(rows.length).toBeGreaterThan(2);
    for (let lineNumber = 1; lineNumber <= rows.length; lineNumber += 1) {
      expect(findUrlLinks(buffer, lineNumber).map((link) => link.text)).toEqual([longUrl]);
    }
  });

  it('joins indented hard-wrapped continuations across more than one extra line', () => {
    const buffer = makeBuffer([
      new MockBufferLine('  Read https://example.com/docs/very/'),
      new MockBufferLine('  long/nested/path/'),
      new MockBufferLine('  page.html for details.'),
    ]);
    const fullUrl = 'https://example.com/docs/very/long/nested/path/page.html';

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe(fullUrl);
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe(fullUrl);
    expect(findUrlLinks(buffer, 3)[0]?.text).toBe(fullUrl);
  });

  it('does not width-join onto an indented next row', () => {
    const text = 'See the docs at https://example.com/a/b';
    const buffer = makeBuffer([
      new MockBufferLine(text, false, text.length),
      new MockBufferLine('  unrelated prose below.', false, 80),
    ]);

    expect(findUrlLinks(buffer, 1)[0]?.text).toBe('https://example.com/a/b');
  });

  it('does not emit a file link for the continuation of a hard-wrapped URL', () => {
    const buffer = makeBuffer([
      new MockBufferLine('Docs at https://github.com/org/repo/blob/'),
      new MockBufferLine('main/docs/page.md for details'),
    ]);

    expect(findFileLinks(buffer, 2)).toEqual([]);
    expect(findUrlLinks(buffer, 2)[0]?.text).toBe(
      'https://github.com/org/repo/blob/main/docs/page.md'
    );
  });
});
