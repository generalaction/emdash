import { resolve } from 'node:path';
import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
} from '@emdash/theme/profiles';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { composerShell, noticeBand } from '../components/chat-composer/chat-composer.css';

async function compileChatComposerStyles(): Promise<string> {
  const uiSource = resolve(__dirname, '../..');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [vanillaExtractPlugin() as never],
    resolve: {
      alias: {
        '@emdash/theme': resolve(__dirname, '../../../../theme/src/core/index.ts'),
        '@styles': resolve(uiSource, 'styles'),
      },
    },
    build: {
      cssCodeSplit: false,
      minify: false,
      rollupOptions: {
        input: {
          composer: resolve(__dirname, '../components/chat-composer/chat-composer.css.ts'),
          permissionBand: resolve(__dirname, '../components/chat-composer/permission-band.css.ts'),
          queuedPromptsBand: resolve(
            __dirname,
            '../components/chat-composer/queued-prompts-band.css.ts'
          ),
        },
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];

  return outputs
    .flatMap((output) => output.output)
    .flatMap((entry) =>
      entry.type === 'asset' && typeof entry.source === 'string' ? [String(entry.source)] : []
    )
    .join('\n');
}

describe('canonical ChatComposer styles', () => {
  it('covers default, focused, disabled, and error states under every profile axis', () => {
    const stateTargets = [
      composerShell(),
      `${composerShell()}:focus-within`,
      composerShell({ disabled: true }),
      noticeBand({ variant: 'error' }),
    ];
    expect(new Set(stateTargets).size).toBe(4);

    for (const colorScheme of COLOR_SCHEME_MANIFEST) {
      for (const density of DENSITY_MANIFEST) {
        for (const typography of TYPOGRAPHY_MANIFEST) {
          const profileScope = `${colorScheme.selector}${density.selector}${typography.selector}`;
          expect(profileScope).toMatch(/^\.em/);
          const scopedStateTargets = stateTargets.map((target) => `${profileScope} ${target}`);
          expect(new Set(scopedStateTargets).size).toBe(4);
          expect(scopedStateTargets.every((target) => target.startsWith('.em'))).toBe(true);
        }
      }
    }
  });

  it('emits active Composer visuals through canonical Recipes and Utilities', async () => {
    const css = await compileChatComposerStyles();

    expect(css).toContain('@layer emdash.recipes {');
    expect(css).toContain('@layer emdash.utilities {');
    expect(css).toContain('background-color: var(--em-surface-emphasis)');
    expect(css).toContain('border-color: var(--em-border-primary)');
    expect(css).toContain('background-color: var(--em-surface-sunken)');
    expect(css).toContain('background-color: var(--em-surface-destructive)');
    expect(css).toContain('font-family: var(--em-font-sans)');
    expect(css).not.toContain('--composer-');
  });
});
