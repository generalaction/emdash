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

const defaultTheme: Theme = {
  colorScheme: null,
  density: DENSITY_MANIFEST[0]!.id,
  typography: TYPOGRAPHY_MANIFEST[0]!.id,
};

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

function renderTheme(theme: Theme | null, isLoading = false): void {
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
  it('resolves every selected profile through public manifests', () => {
    const resolved = resolveDesktopTheme(
      {
        colorScheme: 'solarized-dark',
        density: 'compact',
        typography: 'default',
      },
      false
    );

    expect(resolved.colorScheme).toBe(
      COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'solarized-dark')
    );
    expect(resolved.density).toBe(DENSITY_MANIFEST.find(({ id }) => id === 'compact'));
    expect(resolved.typography).toBe(TYPOGRAPHY_MANIFEST.find(({ id }) => id === 'default'));
  });

  it('uses the system light/dark Color scheme while preserving selected profiles', () => {
    const resolved = resolveDesktopTheme(defaultTheme, true);

    expect(resolved.colorScheme).toBe(COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'dark'));
    expect(resolved.density.id).toBe(defaultTheme.density);
    expect(resolved.typography.id).toBe(defaultTheme.typography);
  });

  it('falls back unknown persisted profile ids by dimension', () => {
    const resolved = resolveDesktopTheme(
      {
        colorScheme: 'unknown-color',
        density: 'unknown-density',
        typography: 'unknown-typography',
      } as unknown as Theme,
      false
    );

    expect(resolved.colorScheme.id).toBe('light');
    expect(resolved.density).toBe(DENSITY_MANIFEST[0]);
    expect(resolved.typography).toBe(TYPOGRAPHY_MANIFEST[0]);
  });

  it('uses the controlled provider as the one complete document class writer', () => {
    document.documentElement.classList.add('host-owned');
    const lightThemeSelection: Theme = {
      ...defaultTheme,
      colorScheme: 'light',
    };
    renderTheme(lightThemeSelection);

    const lightTheme = resolveDesktopTheme(lightThemeSelection, false);
    expect(Array.from(document.documentElement.classList)).toEqual([
      'host-owned',
      ...lightTheme.classNames,
    ]);
    expect(container.querySelector('[data-testid="resolved-theme"]')?.textContent).toBe(
      `${lightTheme.colorScheme.id}/${lightTheme.density.id}/${lightTheme.typography.id}`
    );

    const nextThemeSelection: Theme = {
      colorScheme: 'solarized-dark',
      density: 'compact',
      typography: 'default',
    };
    renderTheme(nextThemeSelection);

    const darkTheme = resolveDesktopTheme(nextThemeSelection, false);
    expect(Array.from(document.documentElement.classList)).toEqual([
      'host-owned',
      ...darkTheme.classNames,
    ]);
    expect(document.documentElement.classList).not.toContain(
      expectedClass(COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'light')!)
    );
  });

  it('preserves every pre-paint profile while persisted settings load', () => {
    const colorScheme = COLOR_SCHEME_MANIFEST.find(({ id }) => id === 'solarized-light')!;
    const density = DENSITY_MANIFEST.find(({ id }) => id === 'compact')!;
    const typography = TYPOGRAPHY_MANIFEST.find(({ id }) => id === 'default')!;
    document.documentElement.classList.add(
      expectedClass(colorScheme),
      expectedClass(density),
      expectedClass(typography)
    );

    renderTheme(null, true);

    expect(Array.from(document.documentElement.classList)).toEqual([
      expectedClass(colorScheme),
      expectedClass(density),
      expectedClass(typography),
    ]);
  });
});
