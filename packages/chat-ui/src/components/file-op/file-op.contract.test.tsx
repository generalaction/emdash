/**
 * file-op — height contract tests.
 *
 * Inverted collapse semantics:
 *   isCollapsed=false → not expanded (collapsed)
 *   isCollapsed=true  → expanded
 */
import { describe, expect, it } from 'vitest';
import { makeContractCtx, renderAndMeasureUnit } from '../../tests/contract';
import { fileOpUnitDef } from './file-op.def';
import { fileOpFixtures } from './file-op.fixtures';

// Collapsed (isCollapsed=false → not expanded for inverted semantics)
const ctxCollapsed = makeContractCtx({ width: 640, isCollapsed: () => false });
// Expanded (isCollapsed=true → expanded for inverted semantics)
const ctxExpanded = makeContractCtx({ width: 640, isCollapsed: () => true });

describe('fileOpUnitDef height contract — collapsed', () => {
  for (const item of fileOpFixtures) {
    it(`op=${item.op} count=${item.ops.length} status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(fileOpUnitDef, item, ctxCollapsed);
      expect(dom).toBe(computed);
    });
  }
});

describe('fileOpUnitDef height contract — expanded', () => {
  for (const item of fileOpFixtures) {
    it(`op=${item.op} count=${item.ops.length} status=${item.status}`, async () => {
      const { computed, dom } = await renderAndMeasureUnit(fileOpUnitDef, item, ctxExpanded);
      expect(dom).toBe(computed);
    });
  }
});
