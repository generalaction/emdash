/**
 * spacing.ts — unit tests.
 *
 * Covers:
 *   1. collapse(): max-semantics, tie-breaking, zeros.
 *   2. resolveSeamGap(): uses declared margins, falls back to fallback, asymmetric.
 *   3. Block-layer seam values: verifies that the margins declared by
 *      proseBlockDef / codeBlockDef / tableBlockDef reproduce the pre-existing
 *      proseGap / blockGap rules via collapse. These are tested here (not in
 *      block-stack.test.ts) because layoutBlockStack transitively imports
 *      BLOCK_REGISTRY components and cannot run in the node test project.
 */

import { describe, expect, it } from 'vitest';
import { collapse, resolveSeamGap } from './spacing';
import type { Margin } from './spacing';

describe('collapse', () => {
  it('returns the larger of the two values', () => {
    expect(collapse(10, 4)).toBe(10);
    expect(collapse(4, 10)).toBe(10);
  });

  it('returns the value when both are equal (tie)', () => {
    expect(collapse(6, 6)).toBe(6);
  });

  it('returns 0 when both are 0', () => {
    expect(collapse(0, 0)).toBe(0);
  });

  it('handles one side being 0', () => {
    expect(collapse(0, 8)).toBe(8);
    expect(collapse(8, 0)).toBe(8);
  });
});

describe('resolveSeamGap', () => {
  const margins: Record<string, Margin> = {
    message: { top: 8, bottom: 8 },
    tool: { top: 2, bottom: 2 },
    diff: { top: 2, bottom: 6 },
  };
  const marginOf = (k: string): Margin | undefined => margins[k];

  it('returns max of adjacent declared margins (symmetric)', () => {
    // tool.bottom=2, tool.top=2 → max(2,2)=2
    expect(resolveSeamGap('tool', 'tool', marginOf, 99)).toBe(2);
  });

  it('returns max of adjacent declared margins (asymmetric)', () => {
    // tool.bottom=2, message.top=8 → max(2,8)=8
    expect(resolveSeamGap('tool', 'message', marginOf, 99)).toBe(8);
    // diff.bottom=6, tool.top=2 → max(6,2)=6
    expect(resolveSeamGap('diff', 'tool', marginOf, 99)).toBe(6);
  });

  it('uses fallback when prev kind has no margin', () => {
    // unknown.bottom=fallback(4), tool.top=2 → max(4,2)=4
    expect(resolveSeamGap('unknown', 'tool', marginOf, 4)).toBe(4);
  });

  it('uses fallback when cur kind has no margin', () => {
    // tool.bottom=2, unknown.top=fallback(4) → max(2,4)=4
    expect(resolveSeamGap('tool', 'unknown', marginOf, 4)).toBe(4);
  });

  it('uses fallback for both sides when neither kind has a margin', () => {
    // fallback(4) on both sides → max(4,4)=4
    expect(resolveSeamGap('x', 'y', marginOf, 4)).toBe(4);
  });
});

// ── Block-layer seam equivalence ──────────────────────────────────────────────
//
// proseBlockDef.margin = (d) => ({ top: d.proseGap, bottom: d.proseGap })  →  4/4
// codeBlockDef.margin  = (d) => ({ top: d.blockGap, bottom: d.blockGap }) → 10/10
// tableBlockDef.margin = (d) => ({ top: d.blockGap, bottom: d.blockGap }) → 10/10
//
// These mirror the DEFAULT_CONFIG density values (proseGap:4, blockGap:10).

describe('block-layer seam equivalence via collapse', () => {
  const PROSE_GAP = 4;
  const BLOCK_GAP = 10;

  // Simulate margins that block defs would return for the default density.
  const blockMargins: Record<string, Margin> = {
    prose: { top: PROSE_GAP, bottom: PROSE_GAP },
    code: { top: BLOCK_GAP, bottom: BLOCK_GAP },
    table: { top: BLOCK_GAP, bottom: BLOCK_GAP },
  };
  const marginOf = (k: string): Margin | undefined => blockMargins[k];

  it('prose↔prose → proseGap (behavior-preserving)', () => {
    expect(resolveSeamGap('prose', 'prose', marginOf, BLOCK_GAP)).toBe(PROSE_GAP);
  });

  it('code↔code → blockGap (behavior-preserving)', () => {
    expect(resolveSeamGap('code', 'code', marginOf, BLOCK_GAP)).toBe(BLOCK_GAP);
  });

  it('table↔table → blockGap (behavior-preserving)', () => {
    expect(resolveSeamGap('table', 'table', marginOf, BLOCK_GAP)).toBe(BLOCK_GAP);
  });

  it('prose↔code → blockGap via max (behavior-preserving)', () => {
    // max(proseGap=4, blockGap=10) = 10
    expect(resolveSeamGap('prose', 'code', marginOf, BLOCK_GAP)).toBe(BLOCK_GAP);
  });

  it('code↔prose → blockGap via max (behavior-preserving)', () => {
    // max(blockGap=10, proseGap=4) = 10
    expect(resolveSeamGap('code', 'prose', marginOf, BLOCK_GAP)).toBe(BLOCK_GAP);
  });

  it('prose↔table → blockGap via max (behavior-preserving)', () => {
    expect(resolveSeamGap('prose', 'table', marginOf, BLOCK_GAP)).toBe(BLOCK_GAP);
  });
});
