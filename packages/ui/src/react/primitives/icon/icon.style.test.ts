import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';

async function compileIconStyles(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [vanillaExtractPlugin() as unknown as PluginOption],
    resolve: {
      alias: {
        '@': resolve(__dirname, '../../..'),
        '@react': resolve(__dirname, '../..'),
        '@styles': resolve(__dirname, '../../../styles'),
      },
    },
    build: {
      cssCodeSplit: false,
      minify: false,
      rollupOptions: {
        external: ['react', 'react/jsx-runtime'],
        input: resolve(__dirname, 'index.tsx'),
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  const css = outputs.flatMap((output) => output.output).find((entry) => entry.type === 'asset');

  if (!css || typeof css.source !== 'string') {
    throw new Error('Icon entry did not emit CSS');
  }

  return css.source;
}

describe('Icon styling contract', () => {
  it('emits inherited color and every authoritative named size in the recipe layer', async () => {
    const css = await compileIconStyles();
    const recipeLayer = css.slice(css.indexOf('@layer emdash.recipes {'));

    expect(recipeLayer).toContain('color: currentColor');
    expect(recipeLayer).toMatch(/width:\s*var\(--[^,]*icon-size[^,]*,\s*1rem\)/);
    expect(recipeLayer).toMatch(/height:\s*var\(--[^,]*icon-size[^,]*,\s*1rem\)/);
    for (const dimension of ['0.75rem', '0.875rem', '1rem', '1.25rem', '1.5rem']) {
      expect(recipeLayer).toContain(`width: ${dimension}`);
      expect(recipeLayer).toContain(`height: ${dimension}`);
    }
    expect(recipeLayer).not.toContain('--em-foreground');
  });

  it('emits one rooted direct-child SVG adapter that fills the slot', async () => {
    const css = await compileIconStyles();
    const directChildRules = css.match(/>\s*svg\s*\{/g) ?? [];

    expect(css).toMatch(/align-items:\s*center/);
    expect(css).toMatch(/display:\s*inline-flex/);
    expect(css).toMatch(/justify-content:\s*center/);
    expect(css).toMatch(/vertical-align:\s*middle/);
    expect(directChildRules).toHaveLength(1);
    expect(css).toMatch(/>\s*svg\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
    expect(css).toMatch(/>\s*svg\s*\{[^}]*pointer-events:\s*none;/s);
  });
});
