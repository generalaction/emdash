/**
 * box — contract tests for the Box combinator algebra.
 *
 * For each primitive and a composed tree, asserts that:
 *   box.measure(ctx) === host.firstElementChild.offsetHeight
 *
 * This proves that the measure and View are in sync, and that width is
 * threaded correctly through chrome wrappers.
 */

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { CachesContext } from '../../components/CachesContext';
import { ThemeContext } from '../../components/ThemeContext';
import { createChatCaches } from '../caches';
import type { RenderCtx } from '../define';
import { DEFAULT_THEME } from '../theme';
import { chrome, clamp, fixedLine, codeLines, text, boxStack } from './box';
import type { Box } from './box';

// ── Helpers ──────────────────────────────────────────────────────────────────

const caches = createChatCaches();

const BASE_CTX = {
  theme: DEFAULT_THEME,
  width: 640,
  isCollapsed: () => false,
  expanded: () => false,
  caches,
};

const hosts: HTMLElement[] = [];

afterEach(() => {
  while (hosts.length > 0) hosts.pop()?.remove();
});

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function mountBox(box: Box, ctx = BASE_CTX): Promise<{ computed: number; dom: number }> {
  const host = document.createElement('div');
  host.style.width = `${ctx.width}px`;
  document.body.appendChild(host);
  hosts.push(host);

  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: () => false },
    measureCtx: () => ctx,
  };

  const computed = box.measure(ctx);

  const dispose = render(
    () => (
      <ThemeContext.Provider value={() => ctx.theme}>
        <CachesContext.Provider value={ctx.caches}>
          <box.View ctx={renderCtx} />
        </CachesContext.Provider>
      </ThemeContext.Provider>
    ),
    host
  );

  await raf();

  const dom = (host.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
  dispose?.();
  return { computed, dom };
}

// ── fixedLine ─────────────────────────────────────────────────────────────────

describe('fixedLine: measure === offsetHeight', () => {
  it('renders a placeholder div at exactly h px', async () => {
    const box = fixedLine(48);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(48);
    expect(dom).toBe(48);
  });

  it('renders a custom View component at exactly h px', async () => {
    const CustomView = () => <div style={{ height: '32px', background: 'red' }} />;
    const box = fixedLine(32, CustomView);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(32);
    expect(dom).toBe(32);
  });
});

// ── codeLines ────────────────────────────────────────────────────────────────

describe('codeLines: measure === offsetHeight', () => {
  it('renders n lines at theme code lineHeight', async () => {
    const n = 5;
    const box = codeLines(n);
    const expected = n * DEFAULT_THEME.fonts.code.lineHeight;
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(expected);
    expect(dom).toBe(expected);
  });
});

// ── text ─────────────────────────────────────────────────────────────────────

describe('text: measure === offsetHeight', () => {
  it('empty blocks produce 0 height', async () => {
    const box = text([]);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(0);
    expect(dom).toBe(0);
  });
});

// ── chrome ───────────────────────────────────────────────────────────────────

describe('chrome: measure === offsetHeight (width threading)', () => {
  it('chrome with padY around a fixedLine', async () => {
    const inner = fixedLine(40);
    const box = chrome({ padY: 8 }, inner);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(8 + 40 + 8);
    expect(dom).toBe(computed);
  });

  it('chrome with headerH and padY around a fixedLine', async () => {
    const HeaderComp = () => <div style={{ height: '32px' }} />;
    const inner = fixedLine(20);
    const box = chrome({ headerH: 32, padY: 4, Header: HeaderComp }, inner);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(32 + 4 + 20 + 4); // border=0 by default
    expect(dom).toBe(computed);
  });

  it('chrome shrinks inner width (width threading)', () => {
    // Verify withWidth threaded to child: capture the width seen by child.measure
    const padX = 16;
    const border = 1;
    let capturedWidth = -1;
    const capturingBox: Box = {
      measure(ctx) {
        capturedWidth = ctx.width;
        return 0;
      },
      estimate: () => 0,
      View: () => <div />,
    };
    const outerBox = chrome({ padX, border }, capturingBox);
    outerBox.measure({ ...BASE_CTX, width: 200 });
    // Child should receive 200 - 2*(padX+border) = 166
    expect(capturedWidth).toBe(200 - 2 * (padX + border));
  });
});

// ── clamp ────────────────────────────────────────────────────────────────────

describe('clamp: measure === offsetHeight', () => {
  it('clamps child height when not expanded', async () => {
    const tall = fixedLine(200);
    const box = clamp(80, {}, tall);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(80);
    expect(dom).toBe(80);
  });
});

// ── Composed tree: chrome(clamp(fixedLine)) ──────────────────────────────────

describe('chrome(clamp(fixedLine)): measure === offsetHeight', () => {
  it('chrome padY=8 around clamp(80) of fixedLine(200)', async () => {
    const inner = fixedLine(200);
    const clamped = clamp(80, {}, inner);
    const box = chrome({ padY: 8 }, clamped);
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(8 + 80 + 8);
    expect(dom).toBe(computed);
  });
});

// ── boxStack ─────────────────────────────────────────────────────────────────

describe('boxStack: measure === offsetHeight', () => {
  it('stacks two fixedLine boxes with a gap', async () => {
    const box = boxStack([fixedLine(20), fixedLine(30)], { gap: 8 });
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(20 + 8 + 30);
    expect(dom).toBe(computed);
  });

  it('applies padY at top and bottom', async () => {
    const box = boxStack([fixedLine(10)], { padY: 6 });
    const { computed, dom } = await mountBox(box);
    expect(computed).toBe(6 + 10 + 6);
    expect(dom).toBe(computed);
  });
});
