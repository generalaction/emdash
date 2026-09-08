import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  FIELD_CONTROL_SIZES,
  FIELD_CONTROL_TONES,
  fieldControl,
  type FieldControlOptions,
} from './field-control';

const canonicalSizes = ['sm', 'base'] as const;
const canonicalTones = ['neutral', 'destructive', 'warning', 'info', 'success'] as const;

async function compilePublicFieldControl(): Promise<string> {
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
        input: resolve(stylesRoot, '__fixtures__/public-field-control.css.ts'),
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  const css = outputs.flatMap((output) => output.output).find((entry) => entry.type === 'asset');

  if (!css || typeof css.source !== 'string') {
    throw new Error('Public field-control fixture did not emit CSS');
  }

  return css.source;
}

describe('public field-control Recipe', () => {
  it('exposes only explicit size and tone axes', () => {
    expect(FIELD_CONTROL_SIZES).toEqual(canonicalSizes);
    expect(FIELD_CONTROL_TONES).toEqual(canonicalTones);

    const classes = [
      ...canonicalSizes.map((size) => fieldControl({ size })),
      ...canonicalTones.map((tone) => fieldControl({ tone })),
    ];

    expect(classes.every((className) => className.length > 0)).toBe(true);
    expect(fieldControl({ size: 'sm' })).not.toBe(fieldControl());
    expect(fieldControl({ tone: 'destructive' })).not.toBe(fieldControl());
    expect(fieldControl({ tone: 'warning' })).not.toBe(fieldControl());
    expect(fieldControl({ tone: 'info' })).not.toBe(fieldControl());
    expect(fieldControl({ tone: 'success' })).not.toBe(fieldControl());
  });

  it('provides a complete base-sized neutral default', () => {
    expect(fieldControl()).toBe(fieldControl({ size: 'base', tone: 'neutral' }));
  });

  it('owns field sizing, tone, and structural states in the recipe layer', async () => {
    const css = await compilePublicFieldControl();
    const recipeLayer = css.slice(css.indexOf('@layer emdash.recipes {'));

    expect(recipeLayer).toContain(':focus-visible');
    expect(recipeLayer).toContain(':disabled');
    expect(recipeLayer).toContain(':read-only');
    expect(recipeLayer).toContain('[aria-readonly="true"]');
    expect(recipeLayer).toContain('[aria-invalid="true"]');
    expect(recipeLayer).toContain('[data-invalid]');
    expect(recipeLayer).toContain('border-color: var(--em-border-destructive)');
    expect(recipeLayer).toContain('height: 1.5rem');
    expect(recipeLayer).toContain('height: 2rem');
    expect(recipeLayer).toContain('--em-icon-size: 1rem');
  });
});

function verifyFieldControlTypes(options: FieldControlOptions): void {
  fieldControl(options);
  fieldControl({ size: 'sm', tone: 'warning' });
  // @ts-expect-error Generic visual variants are not part of the semantic field-control contract.
  fieldControl({ variant: 'outline' });
  // @ts-expect-error Internal field-shell modes are private.
  fieldControl({ interaction: 'within' });
  // @ts-expect-error Control emphasis does not belong to field-control.
  fieldControl({ emphasis: 'high' });
}
void verifyFieldControlTypes;
