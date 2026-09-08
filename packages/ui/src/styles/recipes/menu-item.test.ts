import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';
import { MENU_ITEM_TONES, menuItem, type MenuItemOptions } from './menu-item';

const canonicalTones = ['neutral', 'destructive'] as const;

async function compilePublicMenuItem(): Promise<string> {
  const stylesRoot = resolve(__dirname, '..');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [vanillaExtractPlugin() as unknown as PluginOption],
    resolve: {
      alias: {
        '@': resolve(stylesRoot, '..'),
        '@emdash/theme': resolve(stylesRoot, '../../../theme/src/core/index.ts'),
        '@react': resolve(stylesRoot, '../react'),
        '@styles': stylesRoot,
      },
    },
    build: {
      cssCodeSplit: false,
      minify: false,
      rollupOptions: {
        input: resolve(stylesRoot, '__fixtures__/public-menu-item.css.ts'),
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  const css = outputs.flatMap((output) => output.output).find((entry) => entry.type === 'asset');

  if (!css || typeof css.source !== 'string') {
    throw new Error('Public menu-item fixture did not emit CSS');
  }

  return css.source;
}

describe('public menu-item Recipe', () => {
  it('exposes only semantic tone and structural row options', () => {
    expect(MENU_ITEM_TONES).toEqual(canonicalTones);
    expect(menuItem()).toBe(
      menuItem({
        fullWidth: false,
        inset: false,
        muted: false,
        tone: 'neutral',
        trailingIndicator: false,
      })
    );
    expect(menuItem({ tone: 'destructive' })).not.toBe(menuItem());
    expect(menuItem({ fullWidth: true })).not.toBe(menuItem());
    expect(menuItem({ inset: true })).not.toBe(menuItem());
    expect(menuItem({ muted: true })).not.toBe(menuItem());
    expect(menuItem({ trailingIndicator: true })).not.toBe(menuItem());
  });

  it('owns menu interaction, selection, disabled, and nested-open states', async () => {
    const css = await compilePublicMenuItem();
    const recipeLayer = css.slice(css.indexOf('@layer emdash.recipes {'));

    expect(recipeLayer).toContain(':focus');
    expect(recipeLayer).toContain(':hover');
    expect(recipeLayer).toContain('[data-highlighted]');
    expect(recipeLayer).toContain('[aria-selected="true"]');
    expect(recipeLayer).toContain('[data-selected]');
    expect(recipeLayer).toContain('[data-checked]');
    expect(recipeLayer).toContain('[data-popup-open]');
    expect(recipeLayer).toContain('[data-open]');
    expect(recipeLayer).toContain('[data-disabled]');
    expect(recipeLayer).toContain('[data-hoverable-when-disabled]');
    expect(recipeLayer).toContain('background-color: var(--em-surface-hover)');
    expect(recipeLayer).toContain('background-color: var(--em-surface-selected)');
    expect(recipeLayer).toContain('pointer-events: none');
    expect(recipeLayer).toContain('--em-icon-size: 1rem');
    expect(recipeLayer).not.toMatch(/\ssvg(?::|,|\s|\{)/);
  });
});

function verifyMenuItemTypes(options: MenuItemOptions): void {
  menuItem(options);
  menuItem({ fullWidth: true, inset: true, tone: 'destructive', trailingIndicator: true });
  // @ts-expect-error Internal component state is selector-owned, not a caller variant.
  menuItem({ selected: true });
  // @ts-expect-error Popup depth is not part of the public menu-row contract.
  menuItem({ shadow: 'md' });
}
void verifyMenuItemTypes;
