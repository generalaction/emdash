import { describe, expect, it } from 'vitest';
import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  PROFILE_MANIFESTS,
  TYPOGRAPHY_MANIFEST,
} from '../profiles';
import {
  compileProfile,
  defineTypographyProfile,
  type TypographyProfileDefinition,
} from './compiler';
import { SEMANTIC_TEMPLATE } from './contract/semantic-template';
import { tokens } from './tokens';

const typographyValues = {
  'typography.family.sans': "'Inter Variable', sans-serif",
  'typography.family.mono': "'JetBrains Mono Variable', 'JetBrains Mono', Menlo, Monaco, monospace",
  'typography.weight.normal': '400',
  'typography.weight.medium': '500',
  'typography.weight.semibold': '600',
  'typography.size.micro': '10px',
  'typography.size.tiny': '11px',
  'typography.size.xs': '12px',
  'typography.size.sm': '13px',
  'typography.size.base': '14px',
  'typography.size.lg': '17px',
  'typography.size.xl': '20px',
  'typography.size.twoXl': '24px',
  'typography.lineHeight.micro': '1.2',
  'typography.lineHeight.tiny': '1.3',
  'typography.lineHeight.xs': '1.5',
  'typography.lineHeight.sm': '1.5',
  'typography.lineHeight.base': '1.5',
  'typography.lineHeight.lg': '1.5',
  'typography.lineHeight.xl': '1.4',
  'typography.lineHeight.twoXl': '1.3',
} as const;

describe('canonical Token model', () => {
  it('exports the approved domain-first literal taxonomy', () => {
    expect(Object.keys(tokens)).toEqual([
      'palette',
      'space',
      'radius',
      'typography',
      'motion',
      'shadow',
      'foreground',
      'border',
      'surface',
      'feedback',
      'selection',
    ]);

    expect(tokens.palette.neutral.step1).toBe('var(--em-neutral-1)');
    expect(tokens.palette.purple.contrast).toBe('var(--em-purple-contrast)');
    expect(tokens.space.step0_5).toBe('var(--em-space-0-5)');
    expect(tokens.radius.twoXl).toBe('var(--em-radius-2xl)');
    expect(tokens.typography.family.sans).toBe('var(--em-font-sans)');
    expect(tokens.motion.duration.fast).toBe('var(--em-motion-duration-fast)');
    expect(tokens.shadow.overlay).toBe('var(--em-shadow-overlay)');
    expect(tokens.foreground.muted).toBe('var(--em-foreground-muted)');
    expect(tokens.border.subtle).toBe('var(--em-border-subtle)');
    expect(Object.keys(tokens.surface.level)).toEqual([
      'sunken',
      'base',
      'raised',
      'elevated',
      'overlay',
    ]);
    expect(tokens.surface.role.paper.background).toBe('var(--em-surface-paper)');
    expect(tokens.surface.tone.destructive.foreground).toBe(
      'var(--em-surface-destructive-foreground)'
    );
    expect(tokens.surface.tone.destructive.level.sunken.foreground).toBe(
      'var(--em-surface-destructive-sunken-foreground)'
    );
    expect(tokens.surface.tone.warning.level.raised.border).toBe(
      'var(--em-surface-warning-raised-border)'
    );
    expect(tokens.surface.tone.info.role.paper.background).toBe('var(--em-surface-info-paper)');
    expect(tokens.feedback.success.foreground).toBe('var(--em-foreground-success)');
    expect(tokens.selection.background).toBe('var(--em-selection)');
  });

  it('keeps product-specific VCS, diff, and workflow meanings out of the Token tree', () => {
    const paths: string[] = [];

    function visit(value: object, parent = ''): void {
      for (const [key, child] of Object.entries(value)) {
        const path = parent ? `${parent}.${key}` : key;
        paths.push(path);
        if (typeof child === 'object') visit(child as object, path);
      }
    }

    visit(tokens);

    expect(paths).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/(?:^|\.)(?:vcs|diff|workflow|merged|conflict|inProgress)(?:\.|$)/i),
      ])
    );
  });

  it('keeps product-specific meanings out of the shared semantic catalog', () => {
    expect(Object.keys(SEMANTIC_TEMPLATE)).not.toEqual(
      expect.arrayContaining([
        'foreground-diff-added',
        'foreground-diff-modified',
        'foreground-diff-deleted',
        'foreground-conflict',
        'foreground-merged',
        'status-in-progress',
        'status-in-review',
        'status-done',
        'status-todo',
        'status-cancelled',
      ])
    );
  });
});

describe('public Profile manifests', () => {
  it('publishes ids and selectors for Color scheme, Density, and Typography profiles', () => {
    expect(COLOR_SCHEME_MANIFEST.map(({ id, selector }) => ({ id, selector }))).toEqual([
      { id: 'light', selector: '.emlight' },
      { id: 'dark', selector: '.emdark' },
      { id: 'solarized-light', selector: '.emsolarized-light' },
      { id: 'solarized-dark', selector: '.emsolarized-dark' },
    ]);
    expect(DENSITY_MANIFEST.map(({ id, selector }) => ({ id, selector }))).toEqual([
      { id: 'comfortable', selector: '.density-comfortable' },
      { id: 'compact', selector: '.density-compact' },
    ]);
    expect(TYPOGRAPHY_MANIFEST).toEqual([
      { id: 'default', label: 'Default', selector: '.typography-default' },
    ]);
    expect(PROFILE_MANIFESTS).toEqual({
      colorSchemes: COLOR_SCHEME_MANIFEST,
      densities: DENSITY_MANIFEST,
      typographies: TYPOGRAPHY_MANIFEST,
    });
  });
});

describe('Theme Compiler profile validation', () => {
  const typography = defineTypographyProfile({
    id: 'default',
    label: 'Default',
    selector: '.typography-default',
    values: typographyValues,
  });

  it('compiles every catalog value owned by a profile and no others', () => {
    const compiled = compileProfile(typography);

    expect(compiled).toMatchObject({
      kind: 'typography',
      id: 'default',
      label: 'Default',
      selector: '.typography-default',
    });
    expect(Object.keys(compiled.cssVars)).toHaveLength(Object.keys(typographyValues).length);
    expect(compiled.cssVars['--em-font-sans']).toBe("'Inter Variable', sans-serif");
    expect(compiled.cssVars['--em-text-2xl--line-height']).toBe('1.3');
  });

  it('rejects a missing Token Value', () => {
    const values = { ...typography.values } as Record<string, string>;
    delete values['typography.family.sans'];

    expect(() =>
      compileProfile({ ...typography, values } as unknown as TypographyProfileDefinition)
    ).toThrow('missing Token Value "typography.family.sans"');
  });

  it('rejects an extra Token Value', () => {
    const values = {
      ...typography.values,
      'typography.family.serif': 'serif',
    };

    expect(() => compileProfile({ ...typography, values } as TypographyProfileDefinition)).toThrow(
      'extra Token Value "typography.family.serif"'
    );
  });
});
