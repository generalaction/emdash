/**
 * namespace.ts — CSS custom property namespace for @emdash/ui tokens.
 *
 * TOKEN_NAMESPACE is the single source of truth used by both the Vanilla
 * Extract contract (build-time static string substitution) and the theme
 * codegen (tsx, runtime key emission). Both sides import this module so the
 * prefix can never drift.
 *
 * Set TOKEN_NAMESPACE to '' to disable prefixing (legacy / testing).
 */

export const TOKEN_NAMESPACE = 'em';

/**
 * Returns the CSS custom property name for a given token name.
 * e.g. nsName('background') → '--em-background'
 */
export const nsName = (name: string): string =>
  TOKEN_NAMESPACE ? `--${TOKEN_NAMESPACE}-${name}` : `--${name}`;

/**
 * Returns a CSS var() reference for a given token name.
 * e.g. nsVar('background') → 'var(--em-background)'
 */
export const nsVar = (name: string): string => `var(${nsName(name)})`;
