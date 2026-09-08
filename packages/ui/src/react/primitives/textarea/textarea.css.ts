import { style } from '@styles/index';

/**
 * Anatomy applied on top of field-control to turn the fixed-height control
 * into an auto-growing textarea.
 */
export const textareaOverride = style({
  height: 'auto',
  // field-sizing: content makes the textarea grow with its text content (modern browsers).
  // @ts-ignore — non-standard property, not yet in TypeScript's CSSType
  fieldSizing: 'content',
  minHeight: '4rem',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
});
