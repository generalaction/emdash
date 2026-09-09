import { tokens, type TokenReference } from '@emdash/theme';

export type TailwindColorVariable = `--color-${string}`;
export type LegacyHostVariable = `--${string}`;

export type TailwindColorTarget = Readonly<{
  target: TailwindColorVariable;
  canonical: TokenReference;
}>;

const CANONICAL_TOKEN_REFERENCES = collectTokenReferences(tokens);

function collectTokenReferences(value: object): ReadonlySet<string> {
  const references = new Set<string>();

  function visit(node: object): void {
    for (const child of Object.values(node)) {
      if (typeof child === 'string') {
        references.add(child);
      } else {
        visit(child as object);
      }
    }
  }

  visit(value);
  return references;
}

/**
 * Defines a canonical Tailwind color target. Runtime validation keeps tests
 * useful when malformed data is loaded from generated input rather than
 * inferred by TypeScript.
 */
export function defineTailwindColorTargets(
  targets: readonly TailwindColorTarget[]
): readonly TailwindColorTarget[] {
  const seen = new Set<TailwindColorVariable>();

  for (const target of targets) {
    if (seen.has(target.target)) {
      throw new Error(`Duplicate Tailwind color target "${target.target}"`);
    }
    seen.add(target.target);

    if (!CANONICAL_TOKEN_REFERENCES.has(target.canonical)) {
      throw new Error(`Unknown canonical Token Reference "${target.canonical}"`);
    }
  }

  return targets;
}

/**
 * Canonical target bridge loaded by the atomic host integration.
 */
export const TAILWIND_COLOR_TARGETS = defineTailwindColorTargets([
  {
    target: '--color-background',
    canonical: tokens.palette.neutral.step1,
  },
  {
    target: '--color-background-1',
    canonical: tokens.palette.neutral.step2,
  },
  {
    target: '--color-background-2',
    canonical: tokens.palette.neutral.step3,
  },
  {
    target: '--color-background-3',
    canonical: tokens.palette.neutral.step4,
  },
  {
    target: '--color-foreground',
    canonical: tokens.foreground.default,
  },
  {
    target: '--color-foreground-muted',
    canonical: tokens.foreground.muted,
  },
  {
    target: '--color-foreground-passive',
    canonical: tokens.foreground.passive,
  },
  {
    target: '--color-background-secondary',
    canonical: tokens.palette.neutral.step2,
  },
  {
    target: '--color-background-secondary-1',
    canonical: tokens.palette.neutral.step1,
  },
  {
    target: '--color-background-secondary-2',
    canonical: tokens.palette.neutral.step4,
  },
  {
    target: '--color-background-secondary-3',
    canonical: tokens.palette.neutral.step6,
  },
  {
    target: '--color-foreground-secondary',
    canonical: tokens.foreground.default,
  },
  {
    target: '--color-background-tertiary',
    canonical: tokens.palette.neutral.step3,
  },
  {
    target: '--color-background-tertiary-1',
    canonical: tokens.palette.neutral.step4,
  },
  {
    target: '--color-background-tertiary-2',
    canonical: tokens.palette.neutral.step5,
  },
  {
    target: '--color-background-tertiary-3',
    canonical: tokens.palette.neutral.step6,
  },
  {
    target: '--color-foreground-tertiary',
    canonical: tokens.foreground.default,
  },
  {
    target: '--color-foreground-tertiary-muted',
    canonical: tokens.foreground.muted,
  },
  {
    target: '--color-foreground-tertiary-passive',
    canonical: tokens.foreground.passive,
  },
  {
    target: '--color-background-destructive',
    canonical: tokens.surface.tone.destructive.background,
  },
  {
    target: '--color-foreground-destructive',
    canonical: tokens.surface.tone.destructive.foreground,
  },
  {
    target: '--color-background-quaternary',
    canonical: tokens.palette.neutral.step1,
  },
  {
    target: '--color-background-quaternary-1',
    canonical: tokens.palette.neutral.step2,
  },
  {
    target: '--color-background-quaternary-2',
    canonical: tokens.palette.neutral.step3,
  },
  {
    target: '--color-primary-button-foreground',
    canonical: tokens.palette.accent.contrast,
  },
  {
    target: '--color-border',
    canonical: tokens.border.default,
  },
  {
    target: '--color-border-1',
    canonical: tokens.border.muted,
  },
  {
    target: '--color-border-2',
    canonical: tokens.border.strong,
  },
  {
    target: '--color-border-destructive',
    canonical: tokens.border.destructive,
  },
  {
    target: '--color-border-primary',
    canonical: tokens.border.focus,
  },
  {
    target: '--color-foreground-success',
    canonical: tokens.feedback.success.foreground,
  },
  {
    target: '--color-background-success',
    canonical: tokens.feedback.success.background,
  },
  {
    target: '--color-border-success',
    canonical: tokens.feedback.success.border,
  },
  {
    target: '--color-foreground-error',
    canonical: tokens.feedback.error.foreground,
  },
  {
    target: '--color-foreground-warning',
    canonical: tokens.feedback.warning.foreground,
  },
  {
    target: '--color-background-warning',
    canonical: tokens.feedback.warning.background,
  },
  {
    target: '--color-background-warning-hover',
    canonical: tokens.feedback.warning.hover,
  },
  {
    target: '--color-border-warning',
    canonical: tokens.feedback.warning.border,
  },
  {
    target: '--color-foreground-info',
    canonical: tokens.feedback.info.foreground,
  },
  {
    target: '--color-background-info',
    canonical: tokens.feedback.info.background,
  },
  {
    target: '--color-background-info-hover',
    canonical: tokens.feedback.info.hover,
  },
  {
    target: '--color-border-info',
    canonical: tokens.feedback.info.border,
  },
] as const);

const COLOR_DECLARATION_PATTERN = /(--color-[A-Za-z0-9_-]+)\s*:\s*(var\((--[A-Za-z0-9_-]+)\))\s*;/g;

export type LegacyTailwindAlias = Readonly<{
  target: TailwindColorVariable;
  legacy: LegacyHostVariable;
  canonical: TokenReference;
}>;

/** The cutover bridge has no remaining legacy Host-value aliases. */
export const LEGACY_TAILWIND_ALIASES: readonly LegacyTailwindAlias[] = [];

/**
 * Checks that the cutover bridge exactly matches the canonical target catalog.
 * Unknown, duplicate, missing, and stale legacy mappings all fail.
 */
export function checkLegacyTailwindAliases(
  css: string,
  targets: readonly TailwindColorTarget[] = TAILWIND_COLOR_TARGETS
): readonly LegacyTailwindAlias[] {
  defineTailwindColorTargets(targets);
  const expected = new Map(targets.map((target) => [target.target, target]));
  const active = new Map<TailwindColorVariable, string>();

  for (const match of css.matchAll(COLOR_DECLARATION_PATTERN)) {
    const target = match[1] as TailwindColorVariable;
    const value = match[2]!;
    if (active.has(target)) {
      throw new Error(`Duplicate active Tailwind color target "${target}"`);
    }
    active.set(target, value);
  }

  for (const target of active.keys()) {
    if (!expected.has(target)) {
      throw new Error(`Unknown active Tailwind color target "${target}"`);
    }
  }

  for (const target of targets) {
    const activeValue = active.get(target.target);
    if (activeValue !== target.canonical) {
      throw new Error(
        `Stale legacy alias "${target.target}": expected "${target.canonical}", found "${
          activeValue ?? '<missing>'
        }"`
      );
    }
  }

  return LEGACY_TAILWIND_ALIASES;
}

/** Renders the canonical Tailwind target fragment for host integration. */
export function renderTailwindColorTargets(
  targets: readonly TailwindColorTarget[] = TAILWIND_COLOR_TARGETS
): string {
  defineTailwindColorTargets(targets);
  const declarations = targets
    .map(({ target, canonical }) => `  ${target}: ${canonical};`)
    .join('\n');

  return [
    '/* Generated canonical Tailwind bridge. Loaded by the desktop host integration. */',
    '@theme inline {',
    declarations,
    '}',
    '',
  ].join('\n');
}
