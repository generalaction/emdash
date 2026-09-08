import { readFileSync } from 'node:fs';
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
import {
  chatHostAdapterClassName,
  chatHostAdapterContribution,
  chatHostProperties,
  chatHostTokenValues,
} from './chat-host-adapter.css';

const EXPECTED_CHAT_HOST_PROPERTIES = [
  '--chat-bg',
  '--chat-bg-1',
  '--chat-bg-2',
  '--chat-bg-3',
  '--chat-border',
  '--chat-bubble-user',
  '--chat-bubble-user-fg',
  '--chat-code-bg',
  '--chat-code-inline-bg',
  '--chat-diff-added',
  '--chat-diff-deleted',
  '--chat-diff-modified',
  '--chat-fg',
  '--chat-fg-body',
  '--chat-fg-error',
  '--chat-fg-muted',
  '--chat-fg-passive',
  '--chat-font-mono',
  '--chat-font-sans',
  '--chat-link',
  '--chat-mention-bg',
  '--chat-mention-chip-bg',
  '--chat-mention-chip-fg',
  '--chat-mention-custom-bg',
  '--chat-mention-custom-fg',
  '--chat-mention-fg',
  '--chat-mention-file-bg',
  '--chat-mention-file-fg',
  '--chat-mention-issue-bg',
  '--chat-mention-issue-fg',
  '--chat-mention-symbol-bg',
  '--chat-mention-symbol-fg',
  '--chat-plan-active',
  '--chat-plan-done',
  '--chat-radius-full',
  '--chat-radius-lg',
  '--chat-radius-md',
  '--chat-radius-sm',
  '--chat-radius-xl',
  '--chat-table-header-bg',
  '--chat-user-card-bg',
  '--chat-user-card-border',
  '--chat-user-card-border-hover',
] as const;

async function compileStagedChatStyles(): Promise<string> {
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
          host: resolve(__dirname, 'chat-host-adapter.css.ts'),
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

describe('Chat Host Styling Adapter', () => {
  it('publishes a dedicated contribution subpath', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')
    ) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports['./react/chat-ui/host-adapter']).toEqual({
      types: './dist/src/react/chat-ui/chat-host-adapter.css.d.ts',
      default: './dist/react/chat-ui/host-adapter.js',
    });
  });

  it('maps the complete supported --chat-* host boundary to canonical Token Values', () => {
    const properties = Object.values(chatHostProperties).sort();

    expect(properties).toEqual([...EXPECTED_CHAT_HOST_PROPERTIES].sort());
    expect(Object.keys(chatHostTokenValues).sort()).toEqual(properties);
    expect(
      Object.values(chatHostTokenValues).every(
        (value) => value.startsWith('var(--em-') && value.endsWith(')')
      )
    ).toBe(true);
  });

  it('exposes one contribution for its desktop feature seam', () => {
    expect(chatHostAdapterClassName).not.toBe('');
    expect(chatHostAdapterContribution).toEqual({
      id: 'chat-ui-theme',
      className: chatHostAdapterClassName,
    });
  });

  it('emits the Chat map only through the Host layer', async () => {
    const css = await compileStagedChatStyles();
    const hostLayerStart = css.indexOf('@layer emdash.host {');

    expect(hostLayerStart).toBeGreaterThan(-1);
    for (const property of EXPECTED_CHAT_HOST_PROPERTIES) {
      const declaration = css.indexOf(`${property}: var(--em-`);
      expect(declaration, property).toBeGreaterThan(hostLayerStart);
    }
  });
});

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
    const css = await compileStagedChatStyles();

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
