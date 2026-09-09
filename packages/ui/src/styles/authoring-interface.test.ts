import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';
import { defineIntegrationManifest } from './host';
import { cx, sx } from './index';

async function compileInput(input: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [vanillaExtractPlugin() as unknown as PluginOption],
    resolve: {
      alias: {
        '@': resolve(__dirname, '..'),
        '@emdash/theme': resolve(__dirname, '../../../theme/src/core/index.ts'),
        '@react': resolve(__dirname, '../react'),
        '@styles': __dirname,
      },
    },
    build: {
      cssCodeSplit: false,
      minify: false,
      rollupOptions: {
        input,
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  const css = outputs.flatMap((output) => output.output).find((entry) => entry.type === 'asset');

  if (!css || typeof css.source !== 'string') {
    throw new Error(`Input ${input} did not emit CSS`);
  }

  return css.source;
}

async function compileFixture(name: string): Promise<string> {
  return compileInput(resolve(__dirname, '__fixtures__', name));
}

describe('@emdash/ui/styles authoring interface', () => {
  it('publishes one aggregate CSS path and no retired styling compatibility exports', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
    ) as {
      exports: Record<string, unknown>;
      sideEffects: readonly string[];
    };

    expect(packageJson.exports['./styles']).toEqual({
      types: './dist/src/styles/index.d.ts',
      default: './dist/styles.js',
    });
    expect(packageJson.exports['./styles/host']).toEqual({
      types: './dist/src/styles/host.d.ts',
      default: './dist/styles/host.js',
    });
    expect(packageJson.exports['./styles.css']).toBe('./dist/styles.css');
    expect(packageJson.exports['./styles/recipes/surface']).toEqual({
      types: './dist/src/styles/recipes/surface.d.ts',
      default: './dist/styles/recipes/surface.js',
    });
    expect(packageJson.exports['./styles/recipes/control']).toEqual({
      types: './dist/src/styles/recipes/control.d.ts',
      default: './dist/styles/recipes/control.js',
    });
    expect(packageJson.exports['./styles/recipes/field-control']).toEqual({
      types: './dist/src/styles/recipes/field-control.d.ts',
      default: './dist/styles/recipes/field-control.js',
    });
    expect(packageJson.exports['./styles/recipes/menu-item']).toEqual({
      types: './dist/src/styles/recipes/menu-item.d.ts',
      default: './dist/styles/recipes/menu-item.js',
    });
    expect(packageJson.exports).not.toHaveProperty('./styles/recipes/input');
    expect(packageJson.exports).not.toHaveProperty('./styles/recipes/popup');
    expect(packageJson.exports).not.toHaveProperty('./styles/recipes/popup-surface');
    expect(Object.keys(packageJson.exports).filter((subpath) => subpath.endsWith('.css'))).toEqual([
      './styles.css',
    ]);
    expect(packageJson.exports).not.toHaveProperty('./style.css');
    expect(packageJson.exports).not.toHaveProperty('./styles/tokens.css');
    expect(packageJson.exports).not.toHaveProperty('./styles/global');
    expect(packageJson.exports).not.toHaveProperty('./styles/base.css');
    expect(packageJson.exports).not.toHaveProperty('./styles/global-base.css');
    expect(packageJson.exports).not.toHaveProperty('./styles/effects.css');
    expect(packageJson.exports).not.toHaveProperty('./styles/overflow-fade.css');
    expect(packageJson.exports).not.toHaveProperty('./styles/typography.css');
    expect(packageJson.sideEffects).toEqual(['./dist/styles.css']);
  });

  it('joins only supported string class inputs', () => {
    expect(cx('recipe', false, null, undefined, ['utility', 'override'])).toBe(
      'recipe utility override'
    );
  });

  it('declares the canonical cascade and emits styles in the recipe layer', async () => {
    const css = await compileFixture('public-style.css.ts');

    expect(css).toContain(
      '@layer emdash.vendor, emdash.reset, emdash.tokens, emdash.base, emdash.recipes, emdash.utilities, emdash.host;'
    );
    expect(css).toMatch(/@layer emdash\.recipes\s*\{[^}]*outline:\s*2px solid currentColor;/s);
  });

  it('emits callable recipes and every variant branch in the recipe layer', async () => {
    const css = await compileFixture('public-style.css.ts');
    const recipeLayer = css.slice(css.indexOf('@layer emdash.recipes {'));

    expect(recipeLayer).toContain('border-style: solid');
    expect(recipeLayer).toContain('border-width: 1px');
    expect(recipeLayer).toContain('border-width: 2px');
  });

  it('emits the finite Token-backed sx vocabulary in the utility layer', async () => {
    const css = await compileFixture('public-style.css.ts');
    const utilityLayer = css.slice(css.indexOf('@layer emdash.utilities {'));

    expect(utilityLayer).toContain('display: inline-flex');
    expect(utilityLayer).toContain('gap: var(--em-space-1)');
    expect(utilityLayer).toContain('padding-left: var(--em-space-2)');
    expect(utilityLayer).toContain('border-radius: var(--em-radius-full)');
    expect(utilityLayer).toContain('color: var(--em-foreground-muted)');
    expect(utilityLayer).toContain('background: var(--em-surface)');
    expect(utilityLayer).toContain('color: var(--em-surface-destructive-sunken-foreground)');
    expect(utilityLayer).toContain('background: var(--em-surface-info-paper)');
    expect(sx.properties.has('px')).toBe(true);
    expect(sx.properties.has('paddingLeft')).toBe(true);
  });

  it('confines rooted Host Adapters to the host layer', async () => {
    const css = await compileFixture('host-authoring.css.ts');
    const hostLayer = css.slice(css.indexOf('@layer emdash.host {'));

    expect(hostLayer).toContain('color: var(--em-foreground)');
    expect(hostLayer).toContain('display: block');
    expect(hostLayer).toContain('.foreign-editor');
    expect(hostLayer).toContain('background: var(--em-surface)');
    expect(hostLayer).toContain('opacity: 0.5');
    expect(hostLayer).toContain('opacity: 1');
  });

  it('emits generated imperative integration writers in the host layer', async () => {
    const css = await compileFixture('integration-manifest.css.ts');
    const hostLayer = css.slice(css.indexOf('@layer emdash.host {'));

    expect(hostLayer.match(/--emdash-integration-fixture-editor-editor-background:/g)).toHaveLength(
      1
    );
    expect(hostLayer).toContain(
      '--emdash-integration-fixture-editor-editor-background: var(--em-surface)'
    );
    expect(hostLayer).toContain(
      '--emdash-integration-fixture-editor-cursor-accent: var(--em-foreground-inverse)'
    );
  });

  it('emits Storybook and example escape-hatch styles in the recipe layer', async () => {
    const css = await compileInput(resolve(__dirname, '../react/story-layout.css.ts'));

    expect(css).toMatch(
      /@layer emdash\.recipes\s*\{[\s\S]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/
    );
  });

  it('derives private imperative integration properties and readers from one field map', () => {
    const manifest = defineIntegrationManifest('fixture-editor', {
      background: 'var(--em-surface)',
      foreground: 'var(--em-foreground)',
    });
    const values = new Map([
      ['--emdash-integration-fixture-editor-background', 'rgb(1, 2, 3)'],
      ['--emdash-integration-fixture-editor-foreground', 'rgb(4, 5, 6)'],
    ]);

    expect(manifest.properties).toEqual({
      background: '--emdash-integration-fixture-editor-background',
      foreground: '--emdash-integration-fixture-editor-foreground',
    });
    expect(manifest.declarations).toEqual({
      '--emdash-integration-fixture-editor-background': 'var(--em-surface)',
      '--emdash-integration-fixture-editor-foreground': 'var(--em-foreground)',
    });
    expect(
      manifest.read({
        getPropertyValue: (property) => values.get(property) ?? '',
      })
    ).toEqual({
      background: 'rgb(1, 2, 3)',
      foreground: 'rgb(4, 5, 6)',
    });
  });
});

function verifyCxTypes(): void {
  // @ts-expect-error cx deliberately excludes numbers from the authoring contract.
  cx('recipe', 1);
  // @ts-expect-error cx deliberately excludes object-based conditional class maps.
  cx({ active: true });
}

void verifyCxTypes;
