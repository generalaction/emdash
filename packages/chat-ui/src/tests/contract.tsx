/**
 * contract — shared harness for browser measurement contract tests.
 *
 * Each contract test mounts the real Render component in a fixed-width
 * container and asserts that def.measure(item, ctx).height equals the
 * element's actual offsetHeight.
 *
 * Usage:
 *   import { makeContractCtx, renderAndMeasure } from '../tests/contract';
 *
 *   const ctx = makeContractCtx({ width: 640 });
 *   const { computed, dom } = await renderAndMeasure(def, item, ctx);
 *   expect(computed).toBe(dom);
 *
 * Notes:
 *   - For components that apply height via inline style, the test is trivially
 *     satisfied but still guards against regressions.
 *   - For text-layout components (message, thinking, prose), the test verifies
 *     that pretext shaping matches real browser glyph metrics.
 *   - Tolerance: heights must match exactly (integer px). Sub-pixel disagreements
 *     are bugs in the measurement model.
 */

import { type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach } from 'vitest';
import { ThemeContext } from '../components/ThemeContext';
import type { ComponentDef, MeasureCtx, Measured, RenderCtx } from '../core/define';
import type { ChatTheme } from '../core/theme';
import { DEFAULT_THEME } from '../core/theme';

export type ContractCtx = MeasureCtx;

/**
 * Build a MeasureCtx for contract tests.
 * Defaults: theme = DEFAULT_THEME, width = 640, no collapsed items, no measured map.
 */
export function makeContractCtx(opts: {
  width?: number;
  theme?: ChatTheme;
  isCollapsed?: (id: string) => boolean;
  expanded?: (id: string) => boolean;
}): ContractCtx {
  return {
    theme: opts.theme ?? DEFAULT_THEME,
    width: opts.width ?? 640,
    isCollapsed: opts.isCollapsed ?? (() => false),
    expanded: opts.expanded ?? (() => false),
  };
}

const makeRenderCtx = (): RenderCtx => ({
  viewState: { isCollapsed: () => false },
});

/**
 * Mount `def.Render` in a fixed-width div, wait one rAF for layout, then
 * return both the computed height (from def.measure) and the actual DOM height.
 */
export async function renderAndMeasure<TNode, L>(
  def: ComponentDef<TNode, L>,
  item: TNode,
  ctx: ContractCtx
): Promise<{ computed: number; dom: number; layout: Measured<L> }> {
  const layout = def.measure(item, ctx);
  const renderCtx = makeRenderCtx();
  const theme = ctx.theme;

  const host = document.createElement('div');
  host.style.width = `${ctx.width}px`;
  host.style.position = 'relative';
  host.style.isolation = 'isolate';
  document.body.appendChild(host);

  let dispose: (() => void) | undefined;

  try {
    // oxlint-disable-next-line typescript/no-explicit-any -- JSX typed per-def; safe at boundary
    const Comp = def.Render as (p: any) => JSX.Element;
    dispose = render(
      () => (
        <ThemeContext.Provider value={() => theme}>
          <Comp item={item} layout={layout} ctx={renderCtx} />
        </ThemeContext.Provider>
      ),
      host
    );

    // Wait one rAF for the browser to compute layout.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // Measure the first child element, which is what Render components output.
    const child = host.firstElementChild as HTMLElement | null;
    return { computed: layout.height, dom: child?.offsetHeight ?? 0, layout };
  } finally {
    dispose?.();
    document.body.removeChild(host);
  }
}

// Auto-cleanup containers after each test (belt-and-suspenders).
afterEach(() => {
  document.querySelectorAll('[data-contract-host]').forEach((el) => el.remove());
});
