/**
 * planDef height — verify collapsed / expanded heights and entry layout arithmetic.
 *
 * Imports only from measure.ts (pure arithmetic, no DOM / Solid / pretext).
 * This keeps the test in the node Vitest project.
 *
 * Total height = PLAN_HEADER_H + bodyH + PLAN_CHROME_Y, where:
 *   - expanded:   bodyH = listH
 *   - collapsed:  bodyH = min(listH, PLAN_WINDOW_H)  (capped preview window)
 *   - listH = sum(entryHeights) + (n-1)*PLAN_ENTRY_GAP + 2*PLAN_PAD_Y
 *
 * Zero-height entries verify structure; explicit entry heights verify
 * accumulation and the collapsed-preview cap.
 */

import { describe, expect, it } from 'vitest';
import type { ChatPlan } from '../../model';
import {
  PLAN_CHROME_Y,
  PLAN_ENTRY_GAP,
  PLAN_HEADER_H,
  PLAN_LINE_H,
  PLAN_PAD_Y,
  PLAN_WINDOW_H,
  estimatePlanH,
  measurePlanH,
  planListHeight,
} from './measure';

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
    // listH = 2*PLAN_PAD_Y (no entries), below the cap.
    expect(measurePlanH(makePlan(0), false)).toBe(
      PLAN_HEADER_H + 2 * PLAN_PAD_Y + PLAN_CHROME_Y
    );
  });

  it('zero-height entries stay below the cap → full listH', () => {
    const item = makePlan(3);
    const listH = planListHeight(3);
    expect(listH).toBeLessThan(PLAN_WINDOW_H);
    expect(measurePlanH(item, false)).toBe(PLAN_HEADER_H + listH + PLAN_CHROME_Y);
  });

  it('tall content is capped at PLAN_WINDOW_H', () => {
    const item = makePlan(2);
    // Each entry 200px → listH well above the cap.
    const measured = measurePlanH(item, false, [200, 200]);
    expect(measured).toBe(PLAN_HEADER_H + PLAN_WINDOW_H + PLAN_CHROME_Y);
  });

  it('collapsed < expanded for tall content', () => {
    const item = makePlan(2);
    const collapsed = measurePlanH(item, false, [200, 200]);
    const expanded = measurePlanH(item, true, [200, 200]);
    expect(collapsed).toBeLessThan(expanded);
  });
});

// ── Expanded — zero-height entries ────────────────────────────────────────────

describe('measurePlanH() — expanded, zero-height entries', () => {
  it('0 entries — header + 2*PLAN_PAD_Y + chrome', () => {
    expect(measurePlanH(makePlan(0), true)).toBe(
      PLAN_HEADER_H + 2 * PLAN_PAD_Y + PLAN_CHROME_Y
    );
  });

  it('3 entries — header + 2*PLAN_ENTRY_GAP + 2*PLAN_PAD_Y + chrome', () => {
    const expected = PLAN_HEADER_H + 2 * PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y + PLAN_CHROME_Y;
    expect(measurePlanH(makePlan(3), true)).toBe(expected);
  });

  it('gap scales linearly with entry count', () => {
    const h3 = measurePlanH(makePlan(3), true);
    const h4 = measurePlanH(makePlan(4), true);
    expect(h4 - h3).toBe(PLAN_ENTRY_GAP);
  });
});

// ── Expanded — non-zero entry heights ─────────────────────────────────────────

describe('measurePlanH() — expanded, explicit entry heights', () => {
  it('single entry height 20 — header + 20 + 2*PLAN_PAD_Y + chrome', () => {
    expect(measurePlanH(makePlan(1), true, [20])).toBe(
      PLAN_HEADER_H + 20 + 2 * PLAN_PAD_Y + PLAN_CHROME_Y
    );
  });

  it('two entries [14, 28] — accumulates both + 1 gap + chrome', () => {
    const expected = PLAN_HEADER_H + 14 + 28 + PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y + PLAN_CHROME_Y;
    expect(measurePlanH(makePlan(2), true, [14, 28])).toBe(expected);
  });

  it('wrong entry-heights length falls back to zero-height entries', () => {
    const withMismatch = measurePlanH(makePlan(3), true, [10, 10]);
    const withZero = measurePlanH(makePlan(3), true);
    expect(withMismatch).toBe(withZero);
  });
});

// ── planListHeight ────────────────────────────────────────────────────────────

describe('planListHeight()', () => {
  it('0 entries — 2*PLAN_PAD_Y', () => {
    expect(planListHeight(0)).toBe(2 * PLAN_PAD_Y);
  });

  it('accumulates entry heights and gaps', () => {
    expect(planListHeight(3, [10, 20, 30])).toBe(10 + 20 + 30 + 2 * PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y);
  });
});

// ── Estimate ──────────────────────────────────────────────────────────────────

describe('estimatePlanH()', () => {
  it('collapsed caps at PLAN_WINDOW_H for many entries', () => {
    // 10 entries * 2 lines each → far above the cap.
    const item = makePlan(10);
    expect(estimatePlanH(item, false)).toBe(PLAN_HEADER_H + PLAN_WINDOW_H + PLAN_CHROME_Y);
  });

  it('expanded grows with entry count (2 lines/entry)', () => {
    const n = 3;
    const item = makePlan(n);
    const listH = n * 2 * PLAN_LINE_H + (n - 1) * PLAN_ENTRY_GAP + 2 * PLAN_PAD_Y;
    expect(estimatePlanH(item, true)).toBe(PLAN_HEADER_H + listH + PLAN_CHROME_Y);
  });

  it('estimate always includes header + chrome', () => {
    for (const n of [0, 1, 3, 6]) {
      expect(estimatePlanH(makePlan(n), true)).toBeGreaterThanOrEqual(PLAN_HEADER_H + PLAN_CHROME_Y);
    }
  });
});
