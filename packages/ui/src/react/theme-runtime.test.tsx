import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
} from '@emdash/theme/profiles';
import { resolveTheme, type ThemeProfileIds } from '@emdash/theme/runtime';
/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme-runtime';

const supportedProfileIds: ThemeProfileIds[] = COLOR_SCHEME_MANIFEST.flatMap((colorScheme) =>
  DENSITY_MANIFEST.flatMap((density) =>
    TYPOGRAPHY_MANIFEST.map((typography) => ({
      colorScheme: colorScheme.id,
      density: density.id,
      typography: typography.id,
    }))
  )
);

function ThemeProbe() {
  const theme = useTheme();
  return (
    <output data-testid="theme">
      {theme.colorScheme.id}/{theme.density.id}/{theme.typography.id}
    </output>
  );
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('class');
});

describe('controlled full-profile ThemeProvider', () => {
  it('reconciles every supported Theme on the document and provides the resolved Theme', () => {
    document.documentElement.classList.add('host-owned');
    const firstProfileIds = supportedProfileIds[0]!;
    const view = render(
      <ThemeProvider theme={resolveTheme(firstProfileIds)} target="document">
        <ThemeProbe />
      </ThemeProvider>
    );

    for (const profileIds of supportedProfileIds) {
      const theme = resolveTheme(profileIds);
      view.rerender(
        <ThemeProvider theme={theme} target="document">
          <ThemeProbe />
        </ThemeProvider>
      );

      expect(Array.from(document.documentElement.classList)).toEqual([
        'host-owned',
        ...theme.classNames,
      ]);
      expect(screen.getByTestId('theme').textContent).toBe(
        `${profileIds.colorScheme}/${profileIds.density}/${profileIds.typography}`
      );
    }

    view.unmount();
    expect(Array.from(document.documentElement.classList)).toEqual(['host-owned']);
  });

  it('applies a changing Theme to a subtree without writing document classes', () => {
    const firstTheme = resolveTheme(supportedProfileIds[0]!);
    const lastTheme = resolveTheme(supportedProfileIds.at(-1)!);
    const view = render(
      <ThemeProvider theme={firstTheme} target="subtree" as="section" className="host-owned">
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(view.container.firstElementChild?.className).toBe(
      ['host-owned', ...firstTheme.classNames].join(' ')
    );
    expect(document.documentElement.className).toBe('');

    view.rerender(
      <ThemeProvider theme={lastTheme} target="subtree" as="section" className="host-owned">
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(view.container.firstElementChild?.className).toBe(
      ['host-owned', ...lastTheme.classNames].join(' ')
    );
    expect(document.documentElement.className).toBe('');
  });
});
