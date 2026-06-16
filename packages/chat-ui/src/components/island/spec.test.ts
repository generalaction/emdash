/**
 * islandSpec parity — CSS vars must match ISLAND_FIXED_HEIGHT.
 */

import { describe, expect, it } from 'vitest';
import { ISLAND_FIXED_HEIGHT } from '../../core/metrics';
import { islandSpec } from './spec';

describe('islandSpec.cssVars() parity', () => {
  it('--chat-island-max-h matches ISLAND_FIXED_HEIGHT', () => {
    expect(islandSpec.cssVars()['--chat-island-max-h']).toBe(`${ISLAND_FIXED_HEIGHT}px`);
  });
});

describe('islandSpec.metrics parity', () => {
  it('metrics.fixedHeight matches ISLAND_FIXED_HEIGHT', () => {
    expect(islandSpec.metrics.fixedHeight).toBe(ISLAND_FIXED_HEIGHT);
  });
});
