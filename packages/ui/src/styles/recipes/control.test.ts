import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_EMPHASES,
  CONTROL_SIZES,
  CONTROL_TONES,
  control,
  type ControlOptions,
} from './control';

const canonicalEmphases = ['minimal', 'low', 'medium', 'high'] as const;
const canonicalSizes = ['xs', 'sm', 'base', 'lg'] as const;
const canonicalTones = ['neutral', 'destructive', 'warning', 'info', 'success'] as const;

async function compilePublicControl(): Promise<string> {
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
        input: resolve(stylesRoot, '__fixtures__/public-control.css.ts'),
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  const css = outputs.flatMap((output) => output.output).find((entry) => entry.type === 'asset');

  if (!css || typeof css.source !== 'string') {
    throw new Error('Public control fixture did not emit CSS');
  }

  return css.source;
}

describe('public control Recipe', () => {
  it('exposes explicit emphasis, size, tone, and icon-only axes', () => {
    expect(CONTROL_EMPHASES).toEqual(canonicalEmphases);
    expect(CONTROL_SIZES).toEqual(canonicalSizes);
    expect(CONTROL_TONES).toEqual(canonicalTones);

    const classes = [
      ...canonicalEmphases.map((emphasis) => control({ emphasis })),
      ...canonicalSizes.map((size) => control({ size })),
      ...canonicalTones.map((tone) => control({ tone })),
      control({ iconOnly: true }),
    ];

    expect(classes.every((className) => className.length > 0)).toBe(true);
    expect(control({ emphasis: 'minimal' })).not.toBe(control());
    expect(control({ emphasis: 'medium' })).not.toBe(control());
    expect(control({ emphasis: 'high' })).not.toBe(control());
    expect(control({ size: 'xs' })).not.toBe(control());
    expect(control({ size: 'sm' })).not.toBe(control());
    expect(control({ size: 'lg' })).not.toBe(control());
    expect(control({ tone: 'destructive' })).not.toBe(control());
    expect(control({ tone: 'warning' })).not.toBe(control());
    expect(control({ tone: 'info' })).not.toBe(control());
    expect(control({ tone: 'success' })).not.toBe(control());
    expect(control({ iconOnly: true })).not.toBe(control());
  });

  it('composes all semantic axes through one Recipe', () => {
    const emphasisClass = control({ emphasis: 'high' });
    const sizeClass = control({ size: 'lg' });
    const toneClass = control({ tone: 'destructive' });
    const iconOnlyClass = control({ iconOnly: true, size: 'lg' });
    const combinedClass = control({
      emphasis: 'high',
      size: 'lg',
      tone: 'destructive',
      iconOnly: true,
    });

    const defaultClasses = new Set(control().split(' '));
    const semanticBranchClasses = [emphasisClass, sizeClass, toneClass, iconOnlyClass].flatMap(
      (className) => className.split(' ').filter((part) => !defaultClasses.has(part))
    );

    expect(combinedClass.split(' ')).toEqual(expect.arrayContaining(semanticBranchClasses));
  });

  it('provides a complete low-emphasis neutral default', () => {
    expect(control()).toBe(control({ emphasis: 'low', size: 'base', tone: 'neutral' }));
  });

  it('owns interaction states and sizing in the recipe layer', async () => {
    const css = await compilePublicControl();
    const recipeLayer = css.slice(css.indexOf('@layer emdash.recipes {'));

    expect(recipeLayer).toContain(':focus-visible');
    expect(recipeLayer).toContain(
      ':not(:disabled):not([aria-disabled="true"]):not([data-disabled])'
    );
    expect(recipeLayer).toContain('[aria-pressed="true"]');
    expect(recipeLayer).toContain('[aria-selected="true"]');
    expect(recipeLayer).toContain('[data-selected]');
    expect(recipeLayer).toContain('[data-popup-open]');
    expect(recipeLayer).toContain('[aria-disabled="true"]');
    expect(recipeLayer).toContain('[aria-invalid="true"]');
    expect(recipeLayer).toContain('[data-invalid]');
    expect(recipeLayer).toContain('border-color: var(--em-border-destructive)');
    expect(recipeLayer).toContain('height: 1.5rem');
    expect(recipeLayer).toContain('height: 1.75rem');
    expect(recipeLayer).toContain('height: 2rem');
    expect(recipeLayer).toContain('height: 2.5rem');
    expect(recipeLayer).toContain('--em-icon-size: 1rem');
    expect(recipeLayer).toContain('--em-icon-size: 0.75rem');
    expect(recipeLayer).not.toMatch(/\ssvg(?::|,|\s|\{)/);
  });
});

function verifyControlTypes(options: ControlOptions): void {
  control(options);
  control({ emphasis: 'minimal', size: 'xs', tone: 'warning', iconOnly: true });
  // @ts-expect-error Generic visual variants are not part of the semantic control contract.
  control({ variant: 'ghost' });
  // @ts-expect-error Internal class maps are not part of the semantic control contract.
  control({ classes: { root: 'override' } });
  // @ts-expect-error Link presentation belongs to Button, not the shared size axis.
  control({ size: 'link' });
}
void verifyControlTypes;
