/**
 * measureUnitCached — unit-level measure memo (node tests).
 *
 * The memo is keyed by unit.data object identity (WeakMap) with a fingerprint
 * of `kind|measureEpoch|width|expandedId-relevance` plus a recorded set of
 * isCollapsed/expanded reads observed during measure. Cache hits re-read the
 * recorded ids so reactive tracking is preserved under Solid; these tests
 * exercise the pure invalidation logic.
 */

import { describe, expect, it } from 'vitest';
import type { MeasureCtx } from './define';
import { measureUnitCached } from './unit-measure';
import type { RenderUnit, UnitDef } from './units';

type TestDef = UnitDef<unknown, Record<string, number>>;

const THEME = { fonts: { body: { lineHeight: 20 } } } as unknown as MeasureCtx['theme'];
const CACHES = {} as MeasureCtx['caches'];

function makeCtx(overrides: Partial<MeasureCtx> = {}): MeasureCtx {
  return {
    theme: THEME,
    width: 600,
    isCollapsed: () => false,
    expanded: () => false,
    caches: CACHES,
    measureEpoch: 0,
    expandedId: null,
    ...overrides,
  };
}

function makeUnit(data: unknown, kind = 'test', itemId = 'item-1'): RenderUnit {
  return {
    id: `${itemId}#self`,
    itemId,
    groupId: itemId,
    kind,
    data,
    groupRole: 'solo',
    gapBefore: 0,
  };
}

function countingDef(measure: (data: unknown, ctx: MeasureCtx) => number): {
  def: TestDef;
  calls: () => number;
} {
  let calls = 0;
  const def: TestDef = {
    kind: 'test',
    measure: (data, ctx) => {
      calls++;
      return measure(data, ctx);
    },
    Render: (() => null) as TestDef['Render'],
  };
  return { def, calls: () => calls };
}

describe('measureUnitCached', () => {
  it('measures once per data identity at a stable fingerprint', () => {
    const { def, calls } = countingDef(() => 42);
    const unit = makeUnit({ text: 'hello' });
    const ctx = makeCtx();

    expect(measureUnitCached(unit, ctx, def)).toBe(42);
    expect(measureUnitCached(unit, ctx, def)).toBe(42);
    expect(measureUnitCached(unit, makeCtx(), def)).toBe(42);
    expect(calls()).toBe(1);
  });

  it('re-measures when data identity changes (streaming tail)', () => {
    const { def, calls } = countingDef((data) => (data as { text: string }).text.length);
    const ctx = makeCtx();

    expect(measureUnitCached(makeUnit({ text: 'ab' }), ctx, def)).toBe(2);
    expect(measureUnitCached(makeUnit({ text: 'abcd' }), ctx, def)).toBe(4);
    expect(calls()).toBe(2);
  });

  it('re-measures on width and measureEpoch changes', () => {
    const { def, calls } = countingDef((_, ctx) => ctx.width);
    const unit = makeUnit({});

    expect(measureUnitCached(unit, makeCtx({ width: 600 }), def)).toBe(600);
    expect(measureUnitCached(unit, makeCtx({ width: 400 }), def)).toBe(400);
    expect(measureUnitCached(unit, makeCtx({ width: 400, measureEpoch: 1 }), def)).toBe(400);
    expect(calls()).toBe(3);
    // Back to a seen fingerprint: single-entry memo re-measures (no history).
    measureUnitCached(unit, makeCtx({ width: 600 }), def);
    expect(calls()).toBe(4);
  });

  it('invalidates when a collapse id READ during measure flips; ignores unread ids', () => {
    const state = new Map<string, boolean>([
      ['a', false],
      ['b', false],
    ]);
    const { def, calls } = countingDef((_, ctx) => (ctx.isCollapsed('a') ? 100 : 50));
    const unit = makeUnit({});
    const ctx = makeCtx({ isCollapsed: (id) => state.get(id) ?? false });

    expect(measureUnitCached(unit, ctx, def)).toBe(50);
    // Unrelated id flips: still a cache hit.
    state.set('b', true);
    expect(measureUnitCached(unit, ctx, def)).toBe(50);
    expect(calls()).toBe(1);
    // Read id flips: re-measure.
    state.set('a', true);
    expect(measureUnitCached(unit, ctx, def)).toBe(100);
    expect(calls()).toBe(2);
  });

  it('tracks conditional read sets (id read only in one branch)', () => {
    const state = new Map<string, boolean>([
      ['gate', false],
      ['inner', false],
    ]);
    const { def, calls } = countingDef((_, ctx) => {
      if (!ctx.isCollapsed('gate')) return 10;
      return ctx.isCollapsed('inner') ? 30 : 20;
    });
    const unit = makeUnit({});
    const ctx = makeCtx({ isCollapsed: (id) => state.get(id) ?? false });

    expect(measureUnitCached(unit, ctx, def)).toBe(10);
    // 'inner' was not read yet — flipping it must NOT invalidate.
    state.set('inner', true);
    expect(measureUnitCached(unit, ctx, def)).toBe(10);
    expect(calls()).toBe(1);
    // Opening the gate re-measures and records the new read set.
    state.set('gate', true);
    expect(measureUnitCached(unit, ctx, def)).toBe(30);
    expect(calls()).toBe(2);
    // Now 'inner' IS a dependency.
    state.set('inner', false);
    expect(measureUnitCached(unit, ctx, def)).toBe(20);
    expect(calls()).toBe(3);
  });

  it('records reads through ctx.expanded separately from ctx.isCollapsed', () => {
    const state = new Map<string, boolean>([['x', false]]);
    const { def, calls } = countingDef((_, ctx) => (ctx.expanded('x') ? 200 : 80));
    const unit = makeUnit({});
    const ctx = makeCtx({ expanded: (id) => state.get(id) ?? false });

    expect(measureUnitCached(unit, ctx, def)).toBe(80);
    expect(measureUnitCached(unit, ctx, def)).toBe(80);
    expect(calls()).toBe(1);
    state.set('x', true);
    expect(measureUnitCached(unit, ctx, def)).toBe(200);
    expect(calls()).toBe(2);
  });

  it('expandedId only invalidates the unit it points at', () => {
    const { def: defA, calls: callsA } = countingDef((_, ctx) =>
      ctx.expandedId === 'item-a' ? 360 : 120
    );
    const { def: defB, calls: callsB } = countingDef((_, ctx) =>
      ctx.expandedId === 'item-b' ? 360 : 120
    );
    const unitA = makeUnit({ id: 'item-a' }, 'test', 'item-a');
    const unitB = makeUnit({ id: 'item-b' }, 'test', 'item-b');

    expect(measureUnitCached(unitA, makeCtx({ expandedId: null }), defA)).toBe(120);
    expect(measureUnitCached(unitB, makeCtx({ expandedId: null }), defB)).toBe(120);

    // Expanding A re-measures A but leaves B cached.
    expect(measureUnitCached(unitA, makeCtx({ expandedId: 'item-a' }), defA)).toBe(360);
    expect(measureUnitCached(unitB, makeCtx({ expandedId: 'item-a' }), defB)).toBe(120);
    expect(callsA()).toBe(2);
    expect(callsB()).toBe(1);
  });

  it('passes vars through to measure', () => {
    let seenVars: Record<string, number> | undefined;
    const def: TestDef = {
      kind: 'test',
      vars: { pad: 7 },
      measure: (_, __, vars) => {
        seenVars = vars;
        return 1;
      },
      Render: (() => null) as TestDef['Render'],
    };
    measureUnitCached(makeUnit({}), makeCtx(), def);
    expect(seenVars).toEqual({ pad: 7 });
  });

  it('returns 0 for a missing def', () => {
    expect(measureUnitCached(makeUnit({}), makeCtx(), undefined)).toBe(0);
  });

  it('does not cache (but does not crash) for primitive data', () => {
    const { def, calls } = countingDef(() => 5);
    const ctx = makeCtx();
    expect(measureUnitCached(makeUnit('primitive'), ctx, def)).toBe(5);
    expect(measureUnitCached(makeUnit('primitive'), ctx, def)).toBe(5);
    expect(calls()).toBe(2);
  });
});
