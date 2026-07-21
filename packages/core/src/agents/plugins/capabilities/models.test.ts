import { describe, expect, it } from 'vitest';
import { modelOptionSchema } from './models';

describe('modelOptionSchema', () => {
  it('preserves provider-owned model aliases', () => {
    expect(
      modelOptionSchema.parse({
        name: 'Claude Opus 4.8',
        aliases: ['opus', 'opus[1m]'],
        modelFeatures: { speed: 2, intelligence: 5 },
      })
    ).toEqual({
      name: 'Claude Opus 4.8',
      aliases: ['opus', 'opus[1m]'],
      modelFeatures: { speed: 2, intelligence: 5 },
    });
  });
});
