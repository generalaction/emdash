import { readFileSync } from 'node:fs';
import { THEME_MANIFEST } from '@emdash/ui/react/primitives';
import { describe, expect, it } from 'vitest';
import {
  THEME_CLASS_DARK,
  THEME_CLASS_LIGHT,
  THEME_CLASSES,
  THEME_STORAGE_KEY,
} from './theme-classes';

function manifestClass(id: string): string {
  const entry = THEME_MANIFEST.find((e) => e.id === id);
  if (!entry) throw new Error(`THEME_MANIFEST has no theme with id "${id}"`);
  return entry.selector.replace(/^\./, '');
}

describe('theme class-name convergence with @emdash/theme', () => {
  // The app relies on its theme classes being the exact class names the
  // generated @emdash/theme selectors target (.emlight/.emdark). One classList
  // write must flip both the app palette and the --em-* palette. A rename on
  // either side silently splits the two systems — these tests are the guard.
  it('app light/dark classes equal the THEME_MANIFEST selectors', () => {
    expect(THEME_CLASS_LIGHT).toBe(manifestClass('light'));
    expect(THEME_CLASS_DARK).toBe(manifestClass('dark'));
    expect(THEME_CLASSES).toEqual([THEME_CLASS_LIGHT, THEME_CLASS_DARK]);
  });

  it('index.html pre-paint script uses the same class names and storage key', () => {
    // The inline script cannot import modules, so it hardcodes the literals.
    const html = readFileSync(new URL('../../../../renderer/index.html', import.meta.url), 'utf8');
    expect(html).toContain(`'${THEME_CLASS_LIGHT}'`);
    expect(html).toContain(`'${THEME_CLASS_DARK}'`);
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });
});
