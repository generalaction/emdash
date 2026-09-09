import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TokenReference } from '@emdash/theme';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_HOST_ROOT_ATTRIBUTE,
  DESKTOP_HOST_ROOT_SELECTOR,
  desktopHostRootMarker,
} from '../api/desktop-host-styles';
import {
  checkLegacyTailwindAliases,
  defineTailwindColorTargets,
  LEGACY_TAILWIND_ALIASES,
  renderTailwindColorTargets,
  TAILWIND_COLOR_TARGETS,
} from '../api/tailwind-color-targets';

const desktopRoot = resolve(__dirname, '../../../../..');
const repositoryRoot = resolve(desktopRoot, '../..');
const targetTailwindCssPath = resolve(
  desktopRoot,
  'src/core/primitives/styling/browser/tailwind-color-targets.css'
);
const themeCssPath = resolve(repositoryRoot, 'packages/theme/src/__generated__/styles.css');
const productFixturePath = resolve(__dirname, '__fixtures__/desktop-product-recipes.css.ts');

async function compileProductFixture(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [vanillaExtractPlugin()],
    resolve: {
      alias: {
        '@emdash/theme': resolve(repositoryRoot, 'packages/theme/src/core/index.ts'),
        '@emdash/ui/styles/host': resolve(repositoryRoot, 'packages/ui/src/styles/host.ts'),
        '@core': resolve(desktopRoot, 'src/core'),
      },
    },
    build: {
      cssCodeSplit: false,
      minify: false,
      rollupOptions: {
        input: resolve(__dirname, '__fixtures__/desktop-product-recipes.css.ts'),
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  const entries = outputs.flatMap((output) => output.output);
  const css = entries.find((entry) => entry.fileName.endsWith('.css'));

  if (!css || css.type !== 'asset' || typeof css.source !== 'string') {
    throw new Error('Desktop product Recipe fixture did not emit CSS');
  }

  return css.source;
}

function profileBlock(css: string, selector: string, nextSelector?: string): string {
  const start = css.indexOf(`  ${selector} {`);
  const end = nextSelector ? css.indexOf(`  ${nextSelector} {`, start + 1) : css.length;
  if (start < 0 || end < 0) throw new Error(`Missing generated profile block ${selector}`);
  return css.slice(start, end);
}

describe('desktop Host Styling Adapter staging', () => {
  it('publishes one stable document-root marker without applying it', () => {
    expect(DESKTOP_HOST_ROOT_ATTRIBUTE).toBe('data-emdash-desktop-host');
    expect(DESKTOP_HOST_ROOT_SELECTOR).toBe('[data-emdash-desktop-host]');
    expect(desktopHostRootMarker).toEqual({ 'data-emdash-desktop-host': '' });
  });

  it('keeps the generated Tailwind target on canonical Token Values', () => {
    const targetCss = readFileSync(targetTailwindCssPath, 'utf8');

    expect(targetCss).toBe(renderTailwindColorTargets());
    expect(targetCss).not.toMatch(/var\(--(?!em-)[^)]+\)/);
    expect(targetCss).not.toMatch(
      /--color-(?:foreground-diff|foreground-conflict|foreground-merged|status-)/
    );
  });

  it('keeps the checked temporary alias manifest empty', () => {
    const targetCss = readFileSync(targetTailwindCssPath, 'utf8');

    expect(LEGACY_TAILWIND_ALIASES).toEqual([]);
    expect(checkLegacyTailwindAliases(targetCss)).toEqual([]);
  });

  it('rejects unknown, duplicate, and stale temporary mappings', () => {
    const first = TAILWIND_COLOR_TARGETS[0]!;
    const targetCss = readFileSync(targetTailwindCssPath, 'utf8');

    expect(() =>
      defineTailwindColorTargets([
        {
          ...first,
          canonical: 'var(--em-not-a-token)' as TokenReference,
        },
      ])
    ).toThrow('Unknown canonical Token Reference');
    expect(() => defineTailwindColorTargets([first, first])).toThrow(
      'Duplicate Tailwind color target'
    );
    expect(() =>
      checkLegacyTailwindAliases(
        targetCss.replace(
          '@theme inline {',
          '@theme inline {\n  --color-unknown: var(--em-neutral-1);'
        )
      )
    ).toThrow('Unknown active Tailwind color target');
    expect(() =>
      checkLegacyTailwindAliases(
        targetCss.replace(
          '--color-background: var(--em-neutral-1);',
          '--color-background: var(--background);'
        )
      )
    ).toThrow('Stale legacy alias');
  });

  it('compiles light and dark product fixtures through the public Host Recipe seam', async () => {
    const css = await compileProductFixture();
    const fixture = readFileSync(productFixturePath, 'utf8');
    const themeCss = readFileSync(themeCssPath, 'utf8');
    const light = profileBlock(themeCss, '.emlight', '.emdark');
    const dark = profileBlock(themeCss, '.emdark', '.emsolarized-light');
    const productTokenValues = [
      '--em-green-9',
      '--em-green-10',
      '--em-amber-9',
      '--em-red-9',
      '--em-orange-11',
      '--em-purple-9',
      '--em-foreground-passive',
      '--em-foreground-warning',
    ];

    expect(css).toContain('@layer emdash.host');
    expect(css).toContain(DESKTOP_HOST_ROOT_SELECTOR);
    for (const tokenValue of productTokenValues) {
      expect(css).toContain(`var(${tokenValue})`);
      expect(light).toContain(`${tokenValue}:`);
      expect(dark).toContain(`${tokenValue}:`);
    }
    expect(css).not.toMatch(/--(?:foreground-diff|foreground-conflict|foreground-merged|status-)/);
    expect(fixture).toContain("scheme: 'emlight'");
    expect(fixture).toContain("scheme: 'emdark'");
    expect(fixture).toContain('DESKTOP_HOST_ROOT_ATTRIBUTE');
  });
});
