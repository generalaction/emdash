import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import type { MessageStyleVars } from './metrics';
import { fadeOverlayBottom, fadeOverlayTop } from '@styles/effects.css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────
// Set per-instance via assignInlineVars in message.def.tsx.

export const cardVars = createVariableThemeContract<MessageStyleVars & { height: number }>({
  height: null,
  userCardPadX: null,
  userCardPadY: null,
  cardBorder: null,
  attachThumb: null,
  attachGap: null,
});

export const cardRoot = style({ height: cardVars.height });

// ── UserMessageCard ───────────────────────────────────────────────────────────

export const card = recipe({
  base: {
    position: 'relative',
    borderRadius: vars.radiusLg,
    borderStyle: 'solid',
    borderWidth: cardVars.cardBorder,
    borderColor: vars.userCardBorder,
    background: vars.userCardBg,
    color: vars.fgBody,
    paddingLeft: cardVars.userCardPadX,
    paddingRight: cardVars.userCardPadX,
    paddingTop: cardVars.userCardPadY,
    paddingBottom: cardVars.userCardPadY,
    boxSizing: 'border-box',
  },
  variants: {
    state: {
      static: {},
      overflowing: {
        selectors: {
          '&:hover': { borderColor: vars.userCardBorderHover },
        },
      },
    },
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
  gap: cardVars.attachGap,
  paddingBottom: cardVars.attachGap,
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
  width: cardVars.attachThumb,
  height: cardVars.attachThumb,
  borderRadius: vars.radiusMd,
  objectFit: 'cover',
  boxShadow: `0 0 0 1px ${vars.border}`,
});

export const attachPlaceholder = style({
  width: cardVars.attachThumb,
  height: cardVars.attachThumb,
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
