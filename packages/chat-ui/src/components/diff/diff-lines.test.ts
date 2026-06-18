/**
 * diff-lines unit tests — diff algorithm, countChanges, and selectPreview.
 *
 * The memoization test has moved to caches.test.ts since caching now lives in
 * the ChatCaches bundle (core/caches.ts).
 */

import { describe, expect, it } from 'vitest';
import { computeDiffRows, countChanges, selectPreview } from './diff-lines';

// ── computeDiffRows ────────────────────────────────────────────────────────────

describe('computeDiffRows()', () => {
  it('null oldText → all add rows', () => {
    const rows = computeDiffRows(null, 'a\nb\nc');
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.type).toBe('add');
  });

  it('identical strings → all context rows', () => {
    const text = 'alpha\nbeta\ngamma';
    const rows = computeDiffRows(text, text);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.type).toBe('context');
  });

  it('single-line change → remove + add', () => {
    const rows = computeDiffRows('old', 'new');
    const types = rows.map((r) => r.type);
    expect(types).toContain('remove');
    expect(types).toContain('add');
    expect(types).not.toContain('context');
  });

  it('addition in the middle preserves context', () => {
    const rows = computeDiffRows('a\nb\nc', 'a\nb\nX\nc');
    const types = rows.map((r) => r.type);
    expect(types).toContain('context');
    expect(types).toContain('add');
    expect(types).not.toContain('remove');
  });

  it('deletion in the middle preserves context', () => {
    const rows = computeDiffRows('a\nb\nc', 'a\nc');
    const types = rows.map((r) => r.type);
    expect(types).toContain('context');
    expect(types).toContain('remove');
    expect(types).not.toContain('add');
  });

  it('oldIdx / newIdx are consistent', () => {
    const old = 'x\ny\nz';
    const neew = 'x\nW\nz';
    const rows = computeDiffRows(old, neew);
    const oldLines = old.split('\n');
    const newLines = neew.split('\n');
    for (const r of rows) {
      if (r.type === 'remove' && r.oldIdx !== undefined) {
        expect(r.text).toBe(oldLines[r.oldIdx]);
      }
      if (r.type === 'add' && r.newIdx !== undefined) {
        expect(r.text).toBe(newLines[r.newIdx]);
      }
      if (r.type === 'context') {
        if (r.oldIdx !== undefined) expect(r.text).toBe(oldLines[r.oldIdx]);
        if (r.newIdx !== undefined) expect(r.text).toBe(newLines[r.newIdx]);
      }
    }
  });
});

// ── countChanges ──────────────────────────────────────────────────────────────

describe('countChanges()', () => {
  it('no changes → 0 adds / 0 dels', () => {
    const rows = computeDiffRows('a\nb', 'a\nb');
    expect(countChanges(rows)).toEqual({ adds: 0, dels: 0 });
  });

  it('pure additions → adds > 0, dels = 0', () => {
    const rows = computeDiffRows(null, 'a\nb\nc');
    const { adds, dels } = countChanges(rows);
    expect(adds).toBe(3);
    expect(dels).toBe(0);
  });

  it('mixed edits count correctly', () => {
    const rows = computeDiffRows('a\nb\nc', 'a\nB\nc');
    const { adds, dels } = countChanges(rows);
    expect(adds).toBe(1);
    expect(dels).toBe(1);
  });
});

// ── selectPreview ─────────────────────────────────────────────────────────────

describe('selectPreview()', () => {
  it('returns empty when no changes', () => {
    const rows = computeDiffRows('a\nb', 'a\nb');
    expect(selectPreview(rows)).toHaveLength(0);
  });

  it('anchors at first change with 1 context line before', () => {
    // 5 context lines + 1 change at index 5
    const old = 'c0\nc1\nc2\nc3\nc4\nold';
    const neew = 'c0\nc1\nc2\nc3\nc4\nnew';
    const rows = computeDiffRows(old, neew);
    const preview = selectPreview(rows, 12, 1);
    // First row should be the context at index 4 (= firstChange - 1)
    expect(preview[0]?.type).toBe('context');
    expect(preview[0]?.text).toBe('c4');
  });

  it('caps at maxLines', () => {
    // Build a large diff where the change is at index 0
    const longNew = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const rows = computeDiffRows(null, longNew);
    const preview = selectPreview(rows, 12, 1);
    expect(preview.length).toBeLessThanOrEqual(12);
  });

  it('context=1 default — starts up to 1 line before the first change', () => {
    const rows = computeDiffRows('a\nb\nc', 'a\nB\nc');
    const preview = selectPreview(rows);
    expect(preview.length).toBeGreaterThan(0);
    // Context row before the change must appear
    const hasContext = preview.some((r) => r.type === 'context');
    expect(hasContext).toBe(true);
  });
});
