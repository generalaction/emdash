/**
 * user-message.css.ts — visual styles for UserMessageCard and PinnedUserMessage.
 */

import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';
import { fadeOverlayBottom, fadeOverlayTop } from '../../styles/effects.css';

// ── UserMessageCard ───────────────────────────────────────────────────────────

export const cardBase = style({
  position: 'relative',
  borderRadius: vars.radiusLg,
  border: `1px solid ${vars.border}`,
  background: vars.userCardBg,
  color: vars.fgBody,
  selectors: {
    '&:not([data-expanded]) &:hover': {
      borderColor: vars.userCardBorderHover,
    },
  },
});

/** Hover border color — applied conditionally when not expanded. */
export const cardHoverBorder = style({
  selectors: {
    '&:hover': { borderColor: vars.userCardBorderHover },
  },
});

export const srOnly = style({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
});

export const attachmentStrip = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  paddingBottom: '8px',
});

export const attachThumbBtn = style({
  display: 'block',
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  borderRadius: vars.radiusMd,
  lineHeight: 0,
  selectors: {
    '&:focus-visible': {
      outline: '2px solid currentColor',
      outlineOffset: '2px',
    },
  },
});

export const attachThumb = style({
  display: 'block',
  width: '32px',
  height: '32px',
  borderRadius: vars.radiusMd,
  objectFit: 'cover',
  // ring-1 equivalent
  boxShadow: `0 0 0 1px ${vars.border}`,
});

export const attachPlaceholder = style({
  width: '32px',
  height: '32px',
  borderRadius: vars.radiusMd,
  background: vars.bg2,
  color: vars.fgMuted,
  display: 'grid',
  placeItems: 'center',
  boxShadow: `0 0 0 1px ${vars.border}`,
});

export const cardFadeOverlay = style([
  fadeOverlayBottom,
  {
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: '32px',
    borderBottomLeftRadius: vars.radiusLg,
    borderBottomRightRadius: vars.radiusLg,
  },
]);

// ── PinnedUserMessage ─────────────────────────────────────────────────────────

export const pinnedBackdrop = style({
  // bg-chat-bg/80 = 80% opacity of the chat bg color
  background: `color-mix(in srgb, ${vars.bg} 80%, transparent)`,
  backdropFilter: 'blur(8px)',
  pointerEvents: 'auto',
});

export const pinnedScrollFade = style([
  fadeOverlayTop,
  {
    pointerEvents: 'none',
    height: '16px',
  },
]);
