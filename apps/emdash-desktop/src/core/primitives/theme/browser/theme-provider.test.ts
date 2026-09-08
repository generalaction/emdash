/**
 * @vitest-environment jsdom
 */
import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
} from '@emdash/theme/profiles';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Theme } from '@core/primitives/app-settings/api';
import { ThemeProvider, resolveDesktopTheme, useTheme } from './index';

const container = document.createElement('div');
let root: Root;

function expectedClass(profile: { readonly selector: string }): string {
  return profile.selector.slice(1);
}

function ThemeProbe() {
  const { resolvedTheme } = useTheme();
  return createElement(
    'output',
    { 'data-testid': 'resolved-theme' },
    `${resolvedTheme.colorScheme.id}/${resolvedTheme.density.id}/${resolvedTheme.typography.id}`
  );
}

function renderTheme(theme: Theme, isLoading = false): void {
  act(() => {
    root.render(
      createElement(ThemeProvider, {
        // oxlint-disable-next-line react/no-children-prop -- This .ts test cannot use JSX.
        children: createElement(ThemeProbe),
        theme,
        isLoading,
        onThemeChange: vi.fn(),
      })
    );
  });
}

beforeEach(() => {
  document.body.appendChild(container);
  document.documentElement.className = '';
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container.textContent = '';
  document.documentElement.className = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('active desktop full-profile Theme runtime', () => {
  it('resolves the desktop profile through public manifests', () => {
    const resolved = resolveDesktopTheme('emdark');

    expect(resolved.colorScheme).toBe(COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'dark'));
    expect(resolved.density).toBe(DENSITY_MANIFEST[0]);
    expect(resolved.typography).toBe(TYPOGRAPHY_MANIFEST[0]);
  });

  it('uses the controlled provider as the one complete document class writer', () => {
    document.documentElement.classList.add('host-owned');
    renderTheme('emlight');

    const lightTheme = resolveDesktopTheme('emlight');
    expect(Array.from(document.documentElement.classList)).toEqual([
      'host-owned',
      ...lightTheme.classNames,
    ]);
    expect(container.querySelector('[data-testid="resolved-theme"]')?.textContent).toBe(
      `${lightTheme.colorScheme.id}/${lightTheme.density.id}/${lightTheme.typography.id}`
    );

    renderTheme('emdark');

    const darkTheme = resolveDesktopTheme('emdark');
    expect(Array.from(document.documentElement.classList)).toEqual([
      'host-owned',
      ...darkTheme.classNames,
    ]);
    expect(document.documentElement.classList).not.toContain(
      expectedClass(COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'light')!)
    );
  });

  it('preserves the pre-paint Color scheme while persisted settings load', () => {
    const darkScheme = COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'dark')!;
    document.documentElement.classList.add(expectedClass(darkScheme));

    renderTheme(null, true);

    expect(document.documentElement.classList).toContain(expectedClass(darkScheme));
    expect(document.documentElement.classList).toContain(expectedClass(DENSITY_MANIFEST[0]!));
    expect(document.documentElement.classList).toContain(expectedClass(TYPOGRAPHY_MANIFEST[0]!));
  });
});
