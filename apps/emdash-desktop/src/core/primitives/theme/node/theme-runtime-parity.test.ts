import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
} from '@emdash/theme/profiles';
import {
  resolveTheme,
  THEME_PREPAINT_CLASS_DATA,
  type ThemeProfileIds,
} from '@emdash/theme/runtime';
import { applyTheme } from '@emdash/ui/react/theme-runtime';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { resolvePrepaintThemeClasses } from '../browser/prepaint-theme';

const rendererHtml = readFileSync(resolve(__dirname, '../../../../renderer/index.html'), 'utf8');
const supportedProfileIds: ThemeProfileIds[] = COLOR_SCHEME_MANIFEST.flatMap((colorScheme) =>
  DENSITY_MANIFEST.flatMap((density) =>
    TYPOGRAPHY_MANIFEST.map((typography) => ({
      colorScheme: colorScheme.id,
      density: density.id,
      typography: typography.id,
    }))
  )
);

function runtimeClasses(profileIds: ThemeProfileIds): readonly string[] {
  const classes = new Set<string>();
  applyTheme(
    {
      classList: {
        add: (...classNames: string[]) => classNames.forEach((className) => classes.add(className)),
        remove: (...classNames: string[]) =>
          classNames.forEach((className) => classes.delete(className)),
      },
    },
    resolveTheme(profileIds)
  );
  return Array.from(classes);
}

describe('host pre-paint and controlled runtime Theme parity', () => {
  it('embeds the complete public pre-paint manifest and applies all three profile classes', () => {
    const embeddedManifest = rendererHtml.match(
      /<script id="emdash-theme-prepaint-data" type="application\/json">([\s\S]*?)<\/script>/
    );
    expect(embeddedManifest?.[1]).toBeDefined();
    expect(JSON.parse(embeddedManifest![1])).toEqual(THEME_PREPAINT_CLASS_DATA);

    const dom = new JSDOM(rendererHtml, {
      runScripts: 'dangerously',
      url: 'https://emdash.local',
      beforeParse(window) {
        window.localStorage.setItem(
          'emdash-theme',
          JSON.stringify({
            colorScheme: 'solarized-dark',
            density: 'compact',
            typography: 'default',
          })
        );
        window.matchMedia = () =>
          ({
            matches: false,
          }) as MediaQueryList;
      },
    });

    expect([...dom.window.document.documentElement.classList]).toEqual([
      'emsolarized-dark',
      'density-compact',
      'typography-default',
    ]);
  });

  it('keeps legacy Color scheme preferences compatible', () => {
    const dom = new JSDOM(rendererHtml, {
      runScripts: 'dangerously',
      url: 'https://emdash.local',
      beforeParse(window) {
        window.localStorage.setItem('emdash-theme', JSON.stringify('emdark'));
        window.matchMedia = () =>
          ({
            matches: false,
          }) as MediaQueryList;
      },
    });

    expect([...dom.window.document.documentElement.classList]).toEqual([
      'emdark',
      THEME_PREPAINT_CLASS_DATA.densities[0]!.className,
      THEME_PREPAINT_CLASS_DATA.typographies[0]!.className,
    ]);
  });

  it('falls back unknown persisted ids by dimension using public manifest defaults', () => {
    const dom = new JSDOM(rendererHtml, {
      runScripts: 'dangerously',
      url: 'https://emdash.local',
      beforeParse(window) {
        window.localStorage.setItem(
          'emdash-theme',
          JSON.stringify({
            colorScheme: 'unknown-color',
            density: 'unknown-density',
            typography: 'unknown-typography',
          })
        );
        window.matchMedia = () =>
          ({
            matches: true,
          }) as MediaQueryList;
      },
    });

    const systemDark = THEME_PREPAINT_CLASS_DATA.colorSchemes.find(
      (profile) => profile.polarity === 'dark'
    )!;
    expect([...dom.window.document.documentElement.classList]).toEqual([
      systemDark.className,
      THEME_PREPAINT_CLASS_DATA.densities[0]!.className,
      THEME_PREPAINT_CLASS_DATA.typographies[0]!.className,
    ]);
  });

  it.each(supportedProfileIds)(
    'resolves the same classes for $colorScheme/$density/$typography',
    (profileIds) => {
      expect(resolvePrepaintThemeClasses(profileIds)).toEqual(runtimeClasses(profileIds));
    }
  );

  it.each([
    ['colorScheme', 'unknown-color'],
    ['density', 'unknown-density'],
    ['typography', 'unknown-typography'],
  ] as const)('rejects an unknown %s id on both public seams', (dimension, unknownId) => {
    const profileIds = {
      colorScheme: COLOR_SCHEME_MANIFEST[0].id,
      density: DENSITY_MANIFEST[0]!.id,
      typography: TYPOGRAPHY_MANIFEST[0]!.id,
      [dimension]: unknownId,
    } as ThemeProfileIds;

    expect(() => resolvePrepaintThemeClasses(profileIds)).toThrow(
      `Unknown ${dimension} profile id "${unknownId}"`
    );
    expect(() => runtimeClasses(profileIds)).toThrow(
      `Unknown ${dimension} profile id "${unknownId}"`
    );
  });
});
