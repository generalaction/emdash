/**
 * parse.test.ts — unit tests for the mention tokenizer in parseMarkdownToBlocks.
 *
 * Specifically covers the AT_TOKEN_RE trailing-dot fix: a sentence-final dot
 * must not be absorbed into the token while internal and leading dots are kept.
 *
 * Runs in jsdom because parse.ts → remark-parse → decode-named-character-reference
 * accesses document at module load time.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import type { InlineMention, InlineRun, InlineText, ProseBlock, RuleBlock } from './document';
import type { MentionProvider } from './mention-provider';
import { parseMarkdownToBlocks } from './parse';

// Stub provider that resolves any token it receives as a 'file' mention so
// every matched token becomes a pill without needing a registry of known paths.
const echoProvider: MentionProvider = {
  resolve: (token) => ({ id: token, label: token, kind: 'file' }),
};

function firstProseRuns(text: string): InlineRun[] {
  const blocks = parseMarkdownToBlocks('t', text, echoProvider);
  const prose = blocks.find((b): b is ProseBlock => b.kind === 'prose');
  return prose?.runs ?? [];
}

function mentionLabels(runs: InlineRun[]): string[] {
  return runs.filter((r): r is InlineMention => r.kind === 'mention').map((r) => r.label);
}

function textSegments(runs: InlineRun[]): string[] {
  return runs.filter((r): r is InlineText => r.kind === 'text').map((r) => r.text);
}

// ── Trailing dot stripping ─────────────────────────────────────────────────

describe('AT_TOKEN_RE trailing-dot stripping', () => {
  it('strips a sentence-final dot: @hello.ts. -> token hello.ts', () => {
    const runs = firstProseRuns('Edit @hello.ts.');
    expect(mentionLabels(runs)).toEqual(['hello.ts']);
    // The trailing period should appear as a plain text run after the mention
    const texts = textSegments(runs);
    expect(texts.some((t) => t.includes('.'))).toBe(true);
  });

  it('strips trailing dot from a path mention: @src/auth/jwt.ts.', () => {
    const runs = firstProseRuns('See @src/auth/jwt.ts.');
    expect(mentionLabels(runs)).toEqual(['src/auth/jwt.ts']);
  });

  it('does not strip a non-terminal dot (internal dot preserved)', () => {
    const runs = firstProseRuns('@src/auth/jwt.ts is new');
    expect(mentionLabels(runs)).toEqual(['src/auth/jwt.ts']);
  });

  it('handles two sentence-final mentions: @a.ts. and @b.ts.', () => {
    const runs = firstProseRuns('@a.ts. and @b.ts.');
    expect(mentionLabels(runs)).toEqual(['a.ts', 'b.ts']);
  });
});

// ── Internal and leading dots preserved ───────────────────────────────────

describe('AT_TOKEN_RE dot preservation', () => {
  it('preserves internal dots in file path: @src/auth/jwt.ts', () => {
    const runs = firstProseRuns('@src/auth/jwt.ts');
    expect(mentionLabels(runs)).toEqual(['src/auth/jwt.ts']);
  });

  it('preserves leading dot (dotfile): @.gitignore', () => {
    const runs = firstProseRuns('Ignored @.gitignore file');
    expect(mentionLabels(runs)).toEqual(['.gitignore']);
  });

  it('preserves multiple internal dots: @foo.bar.baz', () => {
    const runs = firstProseRuns('@foo.bar.baz');
    expect(mentionLabels(runs)).toEqual(['foo.bar.baz']);
  });
});

// ── Other token shapes unchanged ──────────────────────────────────────────

describe('AT_TOKEN_RE standard token shapes', () => {
  it('matches issue ref: @issue-42', () => {
    const runs = firstProseRuns('Closes @issue-42');
    expect(mentionLabels(runs)).toEqual(['issue-42']);
  });

  it('matches symbol with parens: @handleSubmit()', () => {
    const runs = firstProseRuns('Call @handleSubmit()');
    expect(mentionLabels(runs)).toEqual(['handleSubmit()']);
  });

  it('matches multiple mentions in one paragraph', () => {
    const runs = firstProseRuns('@foo.ts and @bar-baz and @qux()');
    expect(mentionLabels(runs)).toEqual(['foo.ts', 'bar-baz', 'qux()']);
  });

  it('returns no mentions when provider returns null', () => {
    const nullProvider: MentionProvider = { resolve: () => null };
    const blocks = parseMarkdownToBlocks('t', '@hello.ts', nullProvider);
    const prose = blocks.find((b): b is ProseBlock => b.kind === 'prose');
    const mentions = (prose?.runs ?? []).filter((r) => r.kind === 'mention');
    expect(mentions).toHaveLength(0);
  });
});

// ── Rule block ──────────────────────────────────────────────────────────────

describe('thematicBreak → rule block', () => {
  it('emits a rule block for ---', () => {
    const blocks = parseMarkdownToBlocks('t', '---');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('rule');
  });

  it('rule block has a stable id', () => {
    const blocks = parseMarkdownToBlocks('t', 'before\n\n---\n\nafter');
    const rule = blocks.find((b): b is RuleBlock => b.kind === 'rule');
    expect(rule).toBeDefined();
    expect(rule!.id).toMatch(/^t#/);
  });

  it('prose blocks appear before and after the rule', () => {
    const blocks = parseMarkdownToBlocks('t', 'before\n\n---\n\nafter');
    expect(blocks[0].kind).toBe('prose');
    expect(blocks[1].kind).toBe('rule');
    expect(blocks[2].kind).toBe('prose');
  });

  it('does not emit a prose block for ---', () => {
    const blocks = parseMarkdownToBlocks('t', '---');
    const prose = blocks.find((b) => b.kind === 'prose');
    expect(prose).toBeUndefined();
  });
});

// ── Blockquote → quote variant ───────────────────────────────────────────────

describe('blockquote paragraphs → variant: quote', () => {
  it('blockquote paragraph emits variant: quote', () => {
    const blocks = parseMarkdownToBlocks('t', '> Hello world');
    const prose = blocks.find((b): b is ProseBlock => b.kind === 'prose');
    expect(prose?.variant).toBe('quote');
  });

  it('regular paragraph emits variant: body', () => {
    const blocks = parseMarkdownToBlocks('t', 'Hello world');
    const prose = blocks.find((b): b is ProseBlock => b.kind === 'prose');
    expect(prose?.variant).toBe('body');
  });

  it('nested blockquote paragraphs also emit variant: quote', () => {
    const blocks = parseMarkdownToBlocks('t', '> > Nested');
    const prose = blocks.find((b): b is ProseBlock => b.kind === 'prose');
    expect(prose?.variant).toBe('quote');
  });

  it('blockquote depth is incremented', () => {
    const blocks = parseMarkdownToBlocks('t', '> Hello');
    const prose = blocks.find((b): b is ProseBlock => b.kind === 'prose');
    expect(prose?.depth).toBe(1);
  });
});
