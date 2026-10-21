/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import type { Block, InlineRun, ProseBlock } from './document';
import { parseMarkdownToBlocks } from './parse';

function runText(run: InlineRun): string {
  if (run.kind === 'break') return '\n';
  return run.kind === 'mention' ? run.label : run.text;
}

function proseText(blocks: Block[]): string {
  return blocks
    .filter((block): block is ProseBlock => block.kind === 'prose')
    .map((block) => block.runs.map(runText).join(''))
    .join('\n\n');
}

describe('HTML and XML message content', () => {
  it.each([
    [
      'notification',
      '<task-notification>\n<summary>Monitor finished</summary>\n</task-notification>',
    ],
    ['reminder', '<system-reminder>\nPlease inspect the output.\n</system-reminder>'],
    ['custom element', '<workspace-status>ready</workspace-status>'],
    ['self-closing element', '<workspace-status />'],
    ['block HTML', '<div>Do not lose this message</div>'],
    ['nested HTML', '<section>\n<p>First</p>\n<p>Second</p>\n</section>'],
    ['script', '<script>window.example = true;</script>'],
    ['style', '<style>body { display: none; }</style>'],
    ['preformatted HTML', '<pre>first\n  second</pre>'],
    ['textarea', '<textarea>message body</textarea>'],
    ['comment', '<!-- Keep this diagnostic -->'],
    ['multiline comment', '<!-- first\n\nsecond -->'],
    ['processing instruction', '<?xml version="1.0"?>'],
    ['declaration', '<!DOCTYPE html>'],
    ['CDATA', '<![CDATA[<literal> & text]]>'],
    ['attributes and entities', '<div title="a &amp; b">c &lt; d</div>'],
    ['Unicode', '<summary>继续 🔧 café</summary>'],
  ])('preserves %s as literal prose', (_label, source) => {
    const blocks = parseMarkdownToBlocks('message', source);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((block) => block.kind === 'prose')).toBe(true);
    expect(proseText(blocks)).toBe(source);
  });

  it.each([
    'Use <widget>value</widget> here.',
    'Before <br /> after.',
    'Before <!-- diagnostic --> after.',
  ])('preserves inline tags and their surrounding text: %s', (source) => {
    expect(proseText(parseMarkdownToBlocks('message', source))).toBe(source);
  });

  it('preserves multiline inline tags after Markdown normalizes continuation indentation', () => {
    const blocks = parseMarkdownToBlocks(
      'message',
      'Before <span\n title="value">inside</span> after.'
    );
    expect(proseText(blocks)).toBe('Before <span\ntitle="value">inside</span> after.');
  });

  it('keeps the quote context of a multiline HTML block', () => {
    const blocks = parseMarkdownToBlocks('message', '> <note>\n> Inspect this\n> </note>');
    expect(proseText(blocks)).toBe('<note>\nInspect this\n</note>');
    expect(blocks[0]).toMatchObject({ kind: 'prose', variant: 'quote', depth: 1 });
  });

  it('preserves tags separated from their body by blank lines', () => {
    const source = '<system-reminder>\n\nInspect this\n\n</system-reminder>';
    expect(proseText(parseMarkdownToBlocks('message', source))).toBe(source);
  });

  it('continues decoding explicitly escaped tags as text', () => {
    expect(proseText(parseMarkdownToBlocks('message', '&lt;widget&gt;value&lt;/widget&gt;'))).toBe(
      '<widget>value</widget>'
    );
  });

  it('does not drop a tagged block between ordinary Markdown blocks', () => {
    const source = 'Before\n\n<task-notification>done</task-notification>\n\nAfter';
    const blocks = parseMarkdownToBlocks('message', source, undefined, undefined, 7);
    expect(proseText(blocks)).toBe(source);
    expect(blocks.map((block) => block.id)).toEqual(['message#7', 'message#8', 'message#9']);
  });

  it.each([
    ['heading', '# <widget>value</widget>', 'h1'],
    ['list item', '- <widget>value</widget>', 'list-item'],
    ['blockquote', '> <widget>value</widget>', 'quote'],
  ])('preserves tags in a %s', (_label, source, variant) => {
    const blocks = parseMarkdownToBlocks('message', source);
    expect(proseText(blocks)).toBe('<widget>value</widget>');
    expect(blocks[0]).toMatchObject({ kind: 'prose', variant });
  });

  it('preserves Markdown emphasis and links around inline tags', () => {
    const blocks = parseMarkdownToBlocks(
      'message',
      '**<widget>bold</widget>** [<label>](https://example.com)'
    );
    expect(blocks[0]).toMatchObject({
      kind: 'prose',
      runs: [
        { kind: 'text', text: '<widget>bold</widget>', bold: true },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: '<label>', href: 'https://example.com' },
      ],
    });
  });

  it('preserves tags in table cells', () => {
    const blocks = parseMarkdownToBlocks('message', '| Tag |\n| --- |\n| <widget>value</widget> |');
    expect(blocks[0]).toMatchObject({ kind: 'table', rows: [['<widget>value</widget>']] });
  });

  it('keeps fenced HTML as code', () => {
    const blocks = parseMarkdownToBlocks('message', '```html\n<div>value</div>\n```');
    expect(blocks).toEqual([
      { kind: 'code', id: 'message#0', lang: 'html', code: '<div>value</div>' },
    ]);
  });

  it('keeps inline HTML code as code', () => {
    const blocks = parseMarkdownToBlocks('message', '`<div>value</div>`');
    expect(blocks[0]).toMatchObject({ runs: [{ kind: 'code', text: '<div>value</div>' }] });
  });

  it('keeps autolinks as links', () => {
    const blocks = parseMarkdownToBlocks('message', '<https://example.com>');
    expect(blocks[0]).toMatchObject({
      runs: [{ kind: 'text', text: 'https://example.com', href: 'https://example.com' }],
    });
  });

  it.each(['', ' ', '\n\t\n'])('keeps genuinely empty content empty: %j', (source) => {
    expect(parseMarkdownToBlocks('message', source)).toEqual([]);
  });
});
