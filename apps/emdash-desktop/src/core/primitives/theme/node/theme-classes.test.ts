import { readFileSync } from 'node:fs';
import { COLOR_SCHEME_MANIFEST } from '@emdash/theme/profiles';
import { describe, expect, it } from 'vitest';
// This convergence test reads generated files from disk, so it lives in the
// node surface even though the constants under test are browser code.
import {
  THEME_CLASS_DARK,
  THEME_CLASS_LIGHT,
  THEME_CLASSES,
  THEME_STORAGE_KEY,
} from '../browser/theme-classes';

function manifestClass(id: string): string {
  const entry = COLOR_SCHEME_MANIFEST.find((profile) => profile.id === id);
  if (!entry) throw new Error(`COLOR_SCHEME_MANIFEST has no profile with id "${id}"`);
  return entry.selector.replace(/^\./, '');
}

describe('theme class-name convergence with @emdash/theme', () => {
  // Desktop preference classes must match the canonical Color scheme profile
  // selectors so bootstrap and the controlled runtime resolve one class set.
  it('app light/dark classes equal the Color scheme profile selectors', () => {
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
