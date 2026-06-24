/**
 * chat-root.css.ts — layout classes for ChatRoot.tsx.
 *
 * Previously all inline Tailwind utilities. Now typed VE style objects.
 * The `contentClass` prop API is preserved — hosts who pass a custom string
 * should now pass a VE class or a raw CSS class string.
 */

import { style } from '@vanilla-extract/css';
import { vars } from './styles/theme.css';

/** Outer clip container — clips the pinned overlay during scroll handoff. */
export const outerClip = style({
  position: 'relative',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
  // Base font so chrome text (headers, tool/thinking/plan rows) inherits the
  // sans font rather than the browser default. Prose/code set font-family
  // explicitly; this only affects elements that rely on inheritance.
  fontFamily: vars.fontSans,
});

/** Scroll container — the element ChatRoot attaches its scroll listener to. */
export const scrollContainer = style({
  position: 'relative',
  height: '100%',
  width: '100%',
  overflowX: 'hidden',
  overflowY: 'auto',
});

/** Virtualizer canvas — positions all rows absolutely inside this container. */
export const canvas = style({
  position: 'relative',
});

/** Per-unit row wrapper — translates each row to its virtualizer Y position. */
export const unitRowWrapper = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  willChange: 'transform',
  contain: 'layout paint style',
});

/** Pinned overlay container — absolute, full-width, z above canvas. */
export const pinnedOverlay = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  zIndex: 10,
  willChange: 'transform',
});

/**
 * Default content centering class.
 * Replaces `mx-auto w-full max-w-2xl` from Tailwind.
 * Hosts can override via the `contentClass` prop.
 */
export const defaultContentClass = style({
  marginLeft: 'auto',
  marginRight: 'auto',
  width: '100%',
  maxWidth: '42rem', // Tailwind max-w-2xl = 672px = 42rem
});
