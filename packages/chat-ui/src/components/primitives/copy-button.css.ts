/**
 * copy-button.css.ts — styles for CopyButton.
 *
 * The old `group`/`group-hover:opacity-100` Tailwind pattern is replaced by
 * a VE parent-class selector: the `.group` ancestor class is applied by the
 * parent component (Code.tsx uses BlockFrame with class="group"), and we
 * use a global selector to reveal the button on hover.
 *
 * The parent must have the `groupHover` class applied for the hover to work.
 */

import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';

/** Apply this class to the parent container to enable group-hover reveal. */
export const group = style({});

const buttonBase = style({
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0,
  transition: 'opacity 150ms ease',
  userSelect: 'none',
  color: vars.fgPassive,
  selectors: {
    '&:hover': { color: vars.fg },
    '&:focus-visible': { opacity: 1 },
    [`${group}:hover &`]: { opacity: 1 },
  },
});

export const copyButtonOverlay = style([
  buttonBase,
  {
    position: 'absolute',
    top: '6px',
    right: '6px',
    zIndex: 10,
    borderRadius: '4px',
    padding: '2px',
  },
]);

export const copyButtonInline = style([
  buttonBase,
  {
    gap: '4px',
    fontSize: '0.75rem',
  },
]);
