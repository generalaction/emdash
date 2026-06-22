/**
 * tokens.css.ts — Non-color design tokens in Vanilla Extract.
 *
 * Replaces the :root { --font-*, --text-*, --radius-*, --font-weight-*, --animate-* }
 * blocks that were hand-maintained in theme.base.css. Values are emitted into
 * dist/style.css via the VE build pipeline.
 *
 * Exports a typed `tokenVars` contract so consumers can reference these tokens
 * with full TypeScript safety rather than raw `'var(--text-sm)'` strings.
 * The sprinkles fontSize / fontWeight / fontFamily / borderRadius properties
 * use these refs.
 *
 * Also emits composite typography role vars (--type-*) which are derived from
 * the primitive tokens; these remain as plain strings since they chain one var
 * into another and cannot be represented in the VE typed-vars map.
 */

import { createGlobalThemeContract, globalStyle } from '@vanilla-extract/css';

// ── Primitive non-color token contract ────────────────────────────────────────

export const tokenVars = createGlobalThemeContract(
  {
    // Font families
    fontSans: 'font-sans',
    fontMono: 'font-mono',

    // Font weight scale
    fontWeightNormal: 'font-weight-normal',
    fontWeightMedium: 'font-weight-medium',
    fontWeightSemibold: 'font-weight-semibold',
    fontWeightBold: 'font-weight-bold',

    // Primitive type size scale
    textMicro: 'text-micro',
    textMicroLineHeight: 'text-micro--line-height',
    textTiny: 'text-tiny',
    textTinyLineHeight: 'text-tiny--line-height',
    textXs: 'text-xs',
    textXsLineHeight: 'text-xs--line-height',
    textSm: 'text-sm',
    textSmLineHeight: 'text-sm--line-height',
    textBase: 'text-base',
    textBaseLineHeight: 'text-base--line-height',
    textLg: 'text-lg',
    textLgLineHeight: 'text-lg--line-height',
    textXl: 'text-xl',
    textXlLineHeight: 'text-xl--line-height',
    text2xl: 'text-2xl',
    text2xlLineHeight: 'text-2xl--line-height',

    // Radius scale
    radius: 'radius',
    radiusXs: 'radius-xs',
    radiusSm: 'radius-sm',
    radiusMd: 'radius-md',
    radiusLg: 'radius-lg',
    radiusXl: 'radius-xl',
    radius2xl: 'radius-2xl',
    radiusFull: 'radius-full',

    // Named animation shorthands
    animateAccordionDown: 'animate-accordion-down',
    animateAccordionUp: 'animate-accordion-up',
    animatePanelBlurIn: 'animate-panel-blur-in',
    animatePanelBlurOut: 'animate-panel-blur-out',
  },
  (name) => `--${name}`,
);

export type TokenVars = typeof tokenVars;

// ── Assign static values at :root ─────────────────────────────────────────────

globalStyle(':root', {
  vars: {
    // Font families
    [tokenVars.fontSans]:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    [tokenVars.fontMono]:
      "'JetBrains Mono Variable', 'JetBrains Mono', Menlo, Monaco, monospace",

    // Font weight scale
    [tokenVars.fontWeightNormal]: '400',
    [tokenVars.fontWeightMedium]: '500',
    [tokenVars.fontWeightSemibold]: '600',
    [tokenVars.fontWeightBold]: '700',

    // Primitive type size scale
    [tokenVars.textMicro]: '10px',
    [tokenVars.textMicroLineHeight]: '1.2',
    [tokenVars.textTiny]: '11px',
    [tokenVars.textTinyLineHeight]: '1.3',
    [tokenVars.textXs]: '12px',
    [tokenVars.textXsLineHeight]: '1.5',
    [tokenVars.textSm]: '13px',
    [tokenVars.textSmLineHeight]: '1.5',
    [tokenVars.textBase]: '14px',
    [tokenVars.textBaseLineHeight]: '1.5',
    [tokenVars.textLg]: '17px',
    [tokenVars.textLgLineHeight]: '1.5',
    [tokenVars.textXl]: '20px',
    [tokenVars.textXlLineHeight]: '1.4',
    [tokenVars.text2xl]: '24px',
    [tokenVars.text2xlLineHeight]: '1.3',

    // Radius scale
    [tokenVars.radius]: '0.5rem',
    [tokenVars.radiusXs]: '0.25rem',
    [tokenVars.radiusSm]: '0.375rem',
    [tokenVars.radiusMd]: '0.5rem',
    [tokenVars.radiusLg]: '0.625rem',
    [tokenVars.radiusXl]: '0.875rem',
    [tokenVars.radius2xl]: '1.25rem',
    [tokenVars.radiusFull]: '9999px',

    // Named animation shorthands
    [tokenVars.animateAccordionDown]: 'accordion-down 0.2s ease-out',
    [tokenVars.animateAccordionUp]: 'accordion-up 0.2s ease-out',
    [tokenVars.animatePanelBlurIn]: 'panel-blur-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
    [tokenVars.animatePanelBlurOut]: 'panel-blur-out 140ms ease-in',
  },
});

// ── Composite typography role vars ────────────────────────────────────────────
//
// These chain var→var so they can't go in the typed contract (VE only accepts
// static strings in the `vars` map). They keep the same --type-* names for
// backward compatibility with typography.css.

globalStyle(':root', {
  // @ts-expect-error — VE does not type arbitrary --type-* properties in globalStyle
  '--type-body-font-family': `var(${tokenVars.fontSans})`,
  '--type-body-font-size': `var(${tokenVars.textBase})`,
  '--type-body-font-weight': `var(${tokenVars.fontWeightNormal})`,
  '--type-body-line-height': '20px',

  '--type-body-bold-font-family': `var(${tokenVars.fontSans})`,
  '--type-body-bold-font-size': `var(${tokenVars.textBase})`,
  '--type-body-bold-font-weight': `var(${tokenVars.fontWeightSemibold})`,
  '--type-body-bold-line-height': '20px',

  '--type-body-italic-font-family': `var(${tokenVars.fontSans})`,
  '--type-body-italic-font-size': `var(${tokenVars.textBase})`,
  '--type-body-italic-font-weight': `var(${tokenVars.fontWeightNormal})`,
  '--type-body-italic-font-style': 'italic',
  '--type-body-italic-line-height': '20px',

  '--type-body-link-font-family': `var(${tokenVars.fontSans})`,
  '--type-body-link-font-size': `var(${tokenVars.textBase})`,
  '--type-body-link-font-weight': `var(${tokenVars.fontWeightNormal})`,
  '--type-body-link-line-height': '20px',

  '--type-h1-font-family': `var(${tokenVars.fontSans})`,
  '--type-h1-font-size': `var(${tokenVars.textXl})`,
  '--type-h1-font-weight': `var(${tokenVars.fontWeightSemibold})`,
  '--type-h1-line-height': '28px',

  '--type-h2-font-family': `var(${tokenVars.fontSans})`,
  '--type-h2-font-size': `var(${tokenVars.textLg})`,
  '--type-h2-font-weight': `var(${tokenVars.fontWeightSemibold})`,
  '--type-h2-line-height': '25px',

  '--type-h3-font-family': `var(${tokenVars.fontSans})`,
  '--type-h3-font-size': `var(${tokenVars.textBase})`,
  '--type-h3-font-weight': `var(${tokenVars.fontWeightSemibold})`,
  '--type-h3-line-height': '22px',

  '--type-inline-code-font-family': `var(${tokenVars.fontMono})`,
  '--type-inline-code-font-size': `var(${tokenVars.textXs})`,
  '--type-inline-code-font-weight': `var(${tokenVars.fontWeightNormal})`,
  '--type-inline-code-line-height': '20px',

  '--type-code-font-family': `var(${tokenVars.fontMono})`,
  '--type-code-font-size': `var(${tokenVars.textSm})`,
  '--type-code-font-weight': `var(${tokenVars.fontWeightNormal})`,
  '--type-code-line-height': '20px',

  '--type-code-lang-font-family': `var(${tokenVars.fontSans})`,
  '--type-code-lang-font-size': `var(${tokenVars.textTiny})`,
  '--type-code-lang-font-weight': `var(${tokenVars.fontWeightMedium})`,
  '--type-code-lang-line-height': '16px',

  '--type-mention-font-family': `var(${tokenVars.fontSans})`,
  '--type-mention-font-size': `var(${tokenVars.textBase})`,
  '--type-mention-font-weight': `var(${tokenVars.fontWeightSemibold})`,
  '--type-mention-line-height': '20px',
});
