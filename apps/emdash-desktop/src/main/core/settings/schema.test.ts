import { describe, expect, it } from 'vitest';
import { indexerSettingsSchema } from './schema';

describe('indexerSettingsSchema', () => {
  it('defaults additionalExcludedSegments to an empty array', () => {
    expect(indexerSettingsSchema.parse({})).toEqual({ additionalExcludedSegments: [] });
  });

  it('trims segments and rejects empty strings', () => {
    expect(indexerSettingsSchema.parse({ additionalExcludedSegments: ['  .tox  '] })).toEqual({
      additionalExcludedSegments: ['.tox'],
    });
    expect(() => indexerSettingsSchema.parse({ additionalExcludedSegments: [''] })).toThrow();
  });
});
