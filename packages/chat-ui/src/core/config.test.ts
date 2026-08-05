import { DEFAULT_MONOSPACE_FONT_FAMILIES, DEFAULT_MONOSPACE_FONT_FAMILY } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, toFontConfig } from './config';

describe('default monospace typography', () => {
  it('uses the shared modern system stack for styling and measurement', () => {
    expect(DEFAULT_CONFIG.fonts.mono).toEqual(DEFAULT_MONOSPACE_FONT_FAMILIES);
    expect(toFontConfig(DEFAULT_CONFIG).code.font).toBe(
      `400 13px ${DEFAULT_MONOSPACE_FONT_FAMILY}`
    );
  });

  it('quotes multi-word font families used for text measurement', () => {
    const fonts = toFontConfig(DEFAULT_CONFIG);

    expect(fonts.body.font).toContain("'Inter Variable'");
    expect(fonts.code.font).toContain("'Liberation Mono', 'Courier New'");
  });
});
