/**
 * code.css.ts — styles for Code.tsx.
 *
 * The complex patterns replaced here:
 *   [&_span]:text-(--shiki-light)         → rooted Shiki Adapter
 *   emdark:[&_span]:text-(--shiki-dark)   → rooted Shiki Adapter
 *   scrollbar-thin                         → custom scrollbar styles
 */

import { style } from '@vanilla-extract/css';
import { shikiTokensAdapter } from '@styles/shiki-tokens.adapter.css';
import { vars } from '@styles/theme.css';

/** Scroll + card container (inner div, no .pblock so overflow-x-auto wins). */
export const codeWrapper = style([
  shikiTokensAdapter,
  {
    position: 'absolute',
    inset: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    borderRadius: vars.radiusLg,
    border: `1px solid ${vars.border}`,
    paddingLeft: '8px',
    background: 'transparent',
    // Thin scrollbar
    scrollbarWidth: 'thin',
  },
]);

/** Each code line div — font metrics come from --chat-type-code-* variables. */
export const codeLine = style({
  position: 'absolute',
  whiteSpace: 'pre',
  fontFamily: vars.typeCodeFontFamily,
  fontSize: vars.typeCodeFontSize,
  lineHeight: vars.typeCodeLineHeight,
  fontWeight: vars.typeCodeFontWeight,
  color: vars.fg,
});
