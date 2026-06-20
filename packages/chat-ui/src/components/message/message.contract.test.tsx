/**
 * messageUnitDef — height contract tests.
 *
 * Assert that messageUnitDef.measure(item, ctx) returns the same integer height
 * as the actual DOM offsetHeight of MessageUnitRender for user, assistant, and
 * thought fixtures. A streaming visibility case ensures blank/streaming messages
 * produce a non-zero height and visible DOM output.
 */
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../model';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { messageUnitDef } from './message.def';
import { USER_COLLAPSED_MAX_H, USER_EXPANDED_MAX_H } from './UserMessageCard';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_SHORT: ChatMessage = {
  kind: 'message',
  id: 'user-short',
  role: 'user',
  text: 'Hello, can you help me with a quick question?',
};

const USER_MULTILINE: ChatMessage = {
  kind: 'message',
  id: 'user-multi',
  role: 'user',
  text: 'First line.\n\nSecond paragraph with more content.\n\nThird paragraph.',
};

const ASSISTANT_PLAIN: ChatMessage = {
  kind: 'message',
  id: 'asst-plain',
  role: 'assistant',
  text: 'Of course! I would be happy to help. What is your question?',
};

const ASSISTANT_CODE: ChatMessage = {
  kind: 'message',
  id: 'asst-code',
  role: 'assistant',
  text: 'Here is a simple example:\n\n```ts\nconst x = 1;\nconsole.log(x);\n```\n\nThis prints `1`.',
};

const THOUGHT: ChatMessage = {
  kind: 'message',
  id: 'thought-1',
  role: 'thought',
  text: 'Let me think step by step about this problem.',
};

const STREAMING: ChatMessage = {
  kind: 'message',
  id: 'streaming-1',
  role: 'assistant',
  text: 'Partial response so far…',
  streaming: true,
};

const EMPTY: ChatMessage = {
  kind: 'message',
  id: 'empty-1',
  role: 'assistant',
  text: '',
};

// ── Contexts ──────────────────────────────────────────────────────────────────

const ctx = makeContractCtx({ width: 640 });

// ── Height stability (measure idempotent) ────────────────────────────────────

describe('messageUnitDef.measure is stable (same ctx → same result)', () => {
  const fixtures: ChatMessage[] = [
    USER_SHORT,
    USER_MULTILINE,
    ASSISTANT_PLAIN,
    ASSISTANT_CODE,
    THOUGHT,
    STREAMING,
    EMPTY,
  ];

  for (const item of fixtures) {
    it(`role=${item.role} id=${item.id}`, () => {
      const h1 = messageUnitDef.measure(item, ctx, messageUnitDef.vars!);
      const h2 = messageUnitDef.measure(item, ctx, messageUnitDef.vars!);
      expect(h1).toBe(h2);
      expect(h1).toBeGreaterThan(0);
    });
  }
});

// ── Streaming message is visible ─────────────────────────────────────────────
//
// This case exposed the blank-message regression: a streaming unit kind had no
// matching entry in UNIT_REGISTRY, so UnitRow rendered nothing and reserved 0px.

describe('streaming message', () => {
  it('has non-zero measure height', () => {
    const h = messageUnitDef.measure(STREAMING, ctx, messageUnitDef.vars!);
    expect(h).toBeGreaterThan(0);
  });

  it('renders DOM with non-zero height', async () => {
    const { computed, dom } = await renderAndMeasureUnit(messageUnitDef, STREAMING, ctx);
    expect(computed).toBeGreaterThan(0);
    expect(dom).toBeGreaterThan(0);
  });
});

// ── Empty message falls back to one-line height ───────────────────────────────

describe('empty message', () => {
  it('has non-zero measure height (fallback to line height)', () => {
    const h = messageUnitDef.measure(EMPTY, ctx, messageUnitDef.vars!);
    expect(h).toBeGreaterThan(0);
  });
});

// ── User message card: collapsed / expanded max-height clamp ─────────────────
//
// A user message with enough text to exceed USER_COLLAPSED_MAX_H must be
// clamped to that value when ctx.expandedId is absent, and to
// USER_EXPANDED_MAX_H when ctx.expandedId equals the message id.
// A short message that fits within the collapsed max-height is not clamped.

const USER_LONG: ChatMessage = {
  kind: 'message',
  id: 'user-long',
  role: 'user',
  // ~30 lines of text — well above the 120px collapsed limit.
  text: Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: some content here.`).join('\n\n'),
};

describe('user message card max-height clamp', () => {
  it('collapses to USER_COLLAPSED_MAX_H when content overflows and not expanded', () => {
    const h = messageUnitDef.measure(USER_LONG, ctx, messageUnitDef.vars!);
    expect(h).toBe(USER_COLLAPSED_MAX_H);
  });

  it('expands to at most USER_EXPANDED_MAX_H when expandedId matches', () => {
    const expandedCtx = makeContractCtx({ width: 640, expandedId: USER_LONG.id });
    const h = messageUnitDef.measure(USER_LONG, expandedCtx, messageUnitDef.vars!);
    expect(h).toBeLessThanOrEqual(USER_EXPANDED_MAX_H);
    expect(h).toBeGreaterThan(USER_COLLAPSED_MAX_H);
  });

  it('short user message is not clamped (measures below collapsed max)', () => {
    const h = messageUnitDef.measure(USER_SHORT, ctx, messageUnitDef.vars!);
    expect(h).toBeLessThanOrEqual(USER_COLLAPSED_MAX_H);
    expect(h).toBeGreaterThan(0);
  });

  it('expanding a different id does not affect this message', () => {
    const otherCtx = makeContractCtx({ width: 640, expandedId: 'some-other-id' });
    const h = messageUnitDef.measure(USER_LONG, otherCtx, messageUnitDef.vars!);
    expect(h).toBe(USER_COLLAPSED_MAX_H);
  });
});

// ── compute === dom contract ──────────────────────────────────────────────────
//
// For text-layout components the computed height must exactly match the DOM
// height so that `contain: paint` does not clip content.

describe('messageUnitDef compute === dom', () => {
  const domFixtures: ChatMessage[] = [USER_SHORT, ASSISTANT_PLAIN, THOUGHT, STREAMING, EMPTY];

  for (const item of domFixtures) {
    it(`role=${item.role} id=${item.id}`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(messageUnitDef, item, ctx);
      expect(computed).toBe(dom);
    });
  }
});
