/**
 * Unit tests for prompt-editor serialization.
 *
 * These tests exercise `serializeDoc` in isolation, building lightweight
 * ProseMirror node structures manually so the test can run in vitest's node
 * project without a browser/DOM.
 */

import { describe, expect, it } from 'vitest';
import { serializeDoc } from '@renderer/lib/components/prompt-editor/serialize';
import type { Node } from '@tiptap/pm/model';

// ── Minimal node builders ─────────────────────────────────────────────────────

function makeNode(
  typeName: string,
  attrs: Record<string, unknown>,
  text?: string
): Node {
  // Build a lightweight structural mock that satisfies serializeDoc's API surface.
  const children: Node[] = [];
  const forEachFn = (cb: (child: Node) => void) => children.forEach(cb);

  return {
    type: { name: typeName },
    attrs,
    isText: typeName === 'text',
    text: text ?? null,
    forEach: forEachFn,
    textContent: text ?? '',
  } as unknown as Node;
}

function textNode(t: string): Node {
  return makeNode('text', {}, t);
}

function mentionNode(label: string, id?: string): Node {
  return makeNode('mention', { label: label, id: id ?? label, kind: 'file' });
}

function slashCommandNode(name: string): Node {
  return makeNode('slashCommand', { name, id: name });
}

function hardBreakNode(): Node {
  return makeNode('hardBreak', {});
}

/** Build a fake paragraph block containing the given inline nodes. */
function paragraph(...inlines: Node[]): Node {
  const block = makeNode('paragraph', {});
  (block as unknown as { _children: Node[] })._children = inlines;

  const forEachFn = (cb: (child: Node) => void) => {
    (block as unknown as { _children: Node[] })._children.forEach(cb);
  };
  (block as unknown as { forEach: typeof forEachFn }).forEach = forEachFn;
  return block;
}

/** Build a fake doc containing paragraph blocks. */
function makeDoc(...blocks: Node[]): Node {
  const doc = makeNode('doc', {});
  (doc as unknown as { _blocks: Node[] })._blocks = blocks;

  const forEachFn = (cb: (child: Node) => void) => {
    (doc as unknown as { _blocks: Node[] })._blocks.forEach(cb);
  };
  (doc as unknown as { forEach: typeof forEachFn }).forEach = forEachFn;
  return doc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('serializeDoc', () => {
  it('serializes plain text', () => {
    const doc = makeDoc(paragraph(textNode('Hello world')));
    expect(serializeDoc(doc)).toBe('Hello world');
  });

  it('serializes a mention node as @label', () => {
    const doc = makeDoc(paragraph(textNode('Fix '), mentionNode('src/foo.ts'), textNode(' please')));
    expect(serializeDoc(doc)).toBe('Fix @src/foo.ts please');
  });

  it('serializes a slash command node as /name', () => {
    const doc = makeDoc(paragraph(slashCommandNode('review'), textNode(' this')));
    expect(serializeDoc(doc)).toBe('/review this');
  });

  it('serializes a hard break as \\n within a paragraph', () => {
    const doc = makeDoc(paragraph(textNode('line1'), hardBreakNode(), textNode('line2')));
    expect(serializeDoc(doc)).toBe('line1\nline2');
  });

  it('joins multiple paragraphs with \\n', () => {
    const doc = makeDoc(paragraph(textNode('para1')), paragraph(textNode('para2')));
    expect(serializeDoc(doc)).toBe('para1\npara2');
  });

  it('trims trailing newlines', () => {
    const doc = makeDoc(paragraph(textNode('hello')), paragraph(textNode('')));
    expect(serializeDoc(doc)).toBe('hello');
  });

  it('serializes a complex mixed doc correctly', () => {
    const doc = makeDoc(
      paragraph(textNode('Add '), mentionNode('README.md'), textNode(' and run '), slashCommandNode('lint')),
      paragraph(textNode('Thanks'))
    );
    expect(serializeDoc(doc)).toBe('Add @README.md and run /lint\nThanks');
  });

  it('falls back to id if label is null for a mention', () => {
    const node = makeNode('mention', { label: null, id: 'some-id', kind: 'file' });
    const doc = makeDoc(paragraph(node));
    expect(serializeDoc(doc)).toBe('@some-id');
  });
});
