/**
 * planDef height — verify collapsed / expanded heights and entry layout arithmetic.
 *
 * Imports only from measure.ts (pure arithmetic, no DOM / Solid / pretext) and
 * planUnitDef.vars (the single source of truth for geometry).
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import type { ChatPlan } from '../../model';
import { estimatePlanH, measurePlanH, planListHeight } from './measure';
import { PLAN_VARS } from './metrics';

const v = PLAN_VARS;
const PLAN_PAD_Y = v.padY;
const PLAN_ENTRY_GAP = v.entryGap;
const PLAN_HEADER_H = v.rowH;
const PLAN_WINDOW_H = v.windowH;
const PLAN_CHROME_Y = 3 * v.border;
const PLAN_LINE_H = DEFAULT_FONT_CONFIG.body.lineHeight;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(entryCount: number, streaming = false): ChatPlan {
  return {
    kind: 'plan',
    id: 'test-plan',
    streaming,
    entries: Array.from({ length: entryCount }, (_, i) => ({
      content: `Task ${i + 1}`,
      status: i === 0 ? 'completed' : i === 1 ? 'in_progress' : 'pending',
      priority: i === 0 ? 'high' : i === 1 ? 'medium' : 'low',
    })),
  };
}

// ── Collapsed ─────────────────────────────────────────────────────────────────

describe('measurePlanH() — collapsed (capped preview)', () => {
  it('0 entries — header + listH + chrome (listH < cap)', () => {
    expect(measurePlanH(makePlan(0), false, [], v)).toBe(
      PLAN_HEADER_H + 2 * PLAN_PAD_Y + PLAN_CHROME_Y,
    );
  });

  it('zero-height entries stay below the cap → full listH', () => {
    const item = makePlan(3);
    const listH = planListHeight(3, [], v);
    expect(listH).toBeLessThan(PLAN_WINDOW_H);
    expect(measurePlanH(item, false, [], v)).toBe(PLAN_HEADER_H + listH + PLAN_CHROME_Y);
  });

  it('tall content is capped at PLAN_WINDOW_H', () => {
    const item = makePlan(2);
    const measured = measurePlanH(item, false, [200, 200], v);
    expect(measured).toBe(PLAN_HEADER_H + PLAN_WINDOW_H + PLAN_CHROME_Y);
  });

  it('collapsed < expanded for tall content', () => {
    const item = makePlan(2);
    const collapsed = measurePlanH(item, false, [200, 200], v);
    const expanded = measurePlanH(item, true, [200, 200], v);
    expect(collapsed).toBeLessThan(expanded);
  });
});

// ── Expanded — zero-height entries ────────────────────────────────────────────

describe('measurePlanH() — expanded, zero-height entries', () => {
  it('0 entries — header + 2*PLAN_PAD_Y + chrome', () => {
    expect(measurePlanH(makePlan(0), true, [], v)).toBe(
      PLAN_HEADER_H + 2 * PLAN_PAD_Y + PLAN_CHROME_Y,
    );
  });

  it('3 entries — header + 2*PLAN_ENTRY_GAP + 2*PLAN_PAD_Y + chrome', () => {
    const expected = PLAN_HEADER_H + 2 * PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y + PLAN_CHROME_Y;
    expect(measurePlanH(makePlan(3), true, [], v)).toBe(expected);
  });

  it('gap scales linearly with entry count', () => {
    const h3 = measurePlanH(makePlan(3), true, [], v);
    const h4 = measurePlanH(makePlan(4), true, [], v);
    expect(h4 - h3).toBe(PLAN_ENTRY_GAP);
  });
});

// ── Expanded — non-zero entry heights ─────────────────────────────────────────

describe('measurePlanH() — expanded, explicit entry heights', () => {
  it('single entry height 20 — header + 20 + 2*PLAN_PAD_Y + chrome', () => {
    expect(measurePlanH(makePlan(1), true, [20], v)).toBe(
      PLAN_HEADER_H + 20 + 2 * PLAN_PAD_Y + PLAN_CHROME_Y,
    );
  });

  it('two entries [14, 28] — accumulates both + 1 gap + chrome', () => {
    const expected = PLAN_HEADER_H + 14 + 28 + PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y + PLAN_CHROME_Y;
    expect(measurePlanH(makePlan(2), true, [14, 28], v)).toBe(expected);
  });

  it('wrong entry-heights length falls back to zero-height entries', () => {
    const withMismatch = measurePlanH(makePlan(3), true, [10, 10], v);
    const withZero = measurePlanH(makePlan(3), true, [], v);
    expect(withMismatch).toBe(withZero);
  });
});

// ── planListHeight ────────────────────────────────────────────────────────────

describe('planListHeight()', () => {
  it('0 entries — 2*PLAN_PAD_Y', () => {
    expect(planListHeight(0, [], v)).toBe(2 * PLAN_PAD_Y);
  });

  it('accumulates entry heights and gaps', () => {
    expect(planListHeight(3, [10, 20, 30], v)).toBe(
      10 + 20 + 30 + 2 * PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y,
    );
  });
});

// ── Estimate ──────────────────────────────────────────────────────────────────

describe('estimatePlanH()', () => {
  it('collapsed caps at PLAN_WINDOW_H for many entries', () => {
    const item = makePlan(10);
    expect(estimatePlanH(item, false, v)).toBe(PLAN_HEADER_H + PLAN_WINDOW_H + PLAN_CHROME_Y);
  });

  it('expanded grows with entry count (2 lines/entry)', () => {
    const n = 3;
    const item = makePlan(n);
    const listH = n * 2 * PLAN_LINE_H + (n - 1) * PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y;
    expect(estimatePlanH(item, true, v)).toBe(PLAN_HEADER_H + listH + PLAN_CHROME_Y);
  });

  it('estimate always includes header + chrome', () => {
    for (const n of [0, 1, 3, 6]) {
      expect(estimatePlanH(makePlan(n), true, v)).toBeGreaterThanOrEqual(
        PLAN_HEADER_H + PLAN_CHROME_Y,
      );
    }
  });
});
