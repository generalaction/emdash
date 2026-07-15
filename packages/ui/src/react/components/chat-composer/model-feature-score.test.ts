import { describe, expect, it } from 'vitest';
import { modelFeatureDotCount } from './model-feature-score';

describe('modelFeatureDotCount', () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
    [5, 5],
  ])('renders a %i rating with %i filled dots', (score, expected) => {
    expect(modelFeatureDotCount(score)).toBe(expected);
  });

  it('clamps ratings to the five-dot scale', () => {
    expect(modelFeatureDotCount(-1)).toBe(0);
    expect(modelFeatureDotCount(6)).toBe(5);
  });
});
