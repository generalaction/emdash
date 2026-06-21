import { describe, expect, it } from 'vitest';
import { BROWSER_BOOKMARKS_MAX, browserSettingsSchema } from './schema';
import { SETTINGS_DEFAULTS } from './settings-registry';

function bookmark(index: number) {
  const idSuffix = index.toString(16).padStart(12, '0');
  return {
    id: `11111111-1111-4111-8111-${idSuffix}`,
    url: `https://example.com/${index}`,
    title: `Example ${index}`,
  };
}

describe('browser settings schema', () => {
  it('limits stored bookmarks', () => {
    const baseSettings = SETTINGS_DEFAULTS.browser;

    expect(
      browserSettingsSchema.safeParse({
        ...baseSettings,
        bookmarks: Array.from({ length: BROWSER_BOOKMARKS_MAX }, (_, index) => bookmark(index)),
      }).success
    ).toBe(true);

    expect(
      browserSettingsSchema.safeParse({
        ...baseSettings,
        bookmarks: Array.from({ length: BROWSER_BOOKMARKS_MAX + 1 }, (_, index) => bookmark(index)),
      }).success
    ).toBe(false);
  });
});
