import { describe, expect, it } from 'vitest';
import { COLOR_SCHEME_MANIFEST, DENSITY_MANIFEST, TYPOGRAPHY_MANIFEST } from './profiles';
import { THEME_PREPAINT_CLASS_DATA, resolveTheme, type ThemeProfileIds } from './runtime';

const supportedProfileIds: ThemeProfileIds[] = COLOR_SCHEME_MANIFEST.flatMap((colorScheme) =>
  DENSITY_MANIFEST.flatMap((density) =>
    TYPOGRAPHY_MANIFEST.map((typography) => ({
      colorScheme: colorScheme.id,
      density: density.id,
      typography: typography.id,
    }))
  )
);

describe('full Theme runtime', () => {
  it.each(supportedProfileIds)(
    'resolves $colorScheme/$density/$typography through the public manifests',
    (profileIds) => {
      const theme = resolveTheme(profileIds);

      expect(theme.colorScheme).toBe(
        COLOR_SCHEME_MANIFEST.find(({ id }) => id === profileIds.colorScheme)
      );
      expect(theme.density).toBe(DENSITY_MANIFEST.find(({ id }) => id === profileIds.density));
      expect(theme.typography).toBe(
        TYPOGRAPHY_MANIFEST.find(({ id }) => id === profileIds.typography)
      );
      expect(theme.classNames).toEqual([
        theme.colorScheme.selector.slice(1),
        theme.density.selector.slice(1),
        theme.typography.selector.slice(1),
      ]);
    }
  );

  it('publishes serializable pre-paint class data for every profile dimension', () => {
    expect(THEME_PREPAINT_CLASS_DATA).toEqual({
      colorSchemes: [
        { id: 'light', className: 'emlight' },
        { id: 'dark', className: 'emdark' },
        { id: 'solarized-light', className: 'emsolarized-light' },
        { id: 'solarized-dark', className: 'emsolarized-dark' },
      ],
      densities: [
        { id: 'comfortable', className: 'density-comfortable' },
        { id: 'compact', className: 'density-compact' },
      ],
      typographies: [{ id: 'default', className: 'typography-default' }],
    });
    expect(JSON.parse(JSON.stringify(THEME_PREPAINT_CLASS_DATA))).toEqual(
      THEME_PREPAINT_CLASS_DATA
    );
  });

  it.each([
    ['colorScheme', 'unknown-color'],
    ['density', 'unknown-density'],
    ['typography', 'unknown-typography'],
  ] as const)('rejects an unknown %s profile id', (dimension, unknownId) => {
    const profileIds = {
      colorScheme: COLOR_SCHEME_MANIFEST[0].id,
      density: DENSITY_MANIFEST[0]!.id,
      typography: TYPOGRAPHY_MANIFEST[0]!.id,
      [dimension]: unknownId,
    } as ThemeProfileIds;

    expect(() => resolveTheme(profileIds)).toThrow(
      `Unknown ${dimension} profile id "${unknownId}"`
    );
  });
});
