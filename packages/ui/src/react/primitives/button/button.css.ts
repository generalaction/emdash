import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

/**
 * Button-owned presentation that is intentionally outside the shared control
 * contract: link geometry and trailing Kbd alignment/theme.
 */
export const root = style({
  selectors: {
    '&[data-presentation="link"]': {
      height: 'auto',
      gap: '0.25rem',
      border: 'none',
      backgroundColor: 'transparent',
      padding: 0,
      color: tokens.foreground.default,
    },
    '&[data-presentation="link"]:hover': {
      backgroundColor: 'transparent',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
    },
    '&[data-emphasis="high"][data-tone="neutral"]': {
      vars: {
        '--_kbd-bg': 'color-mix(in srgb, black 20%, transparent)',
        '--_kbd-border': 'transparent',
        '--_kbd-color': `color-mix(in srgb, ${tokens.palette.accent.contrast} 70%, transparent)`,
      },
    },
    '&[data-emphasis="high"][data-tone="destructive"]': {
      vars: {
        '--_kbd-bg': tokens.palette.red.step2,
        '--_kbd-border': 'transparent',
        '--_kbd-color': `color-mix(in srgb, ${tokens.palette.red.step11} 70%, transparent)`,
      },
    },
    '&[data-emphasis="medium"]': {
      vars: {
        '--_kbd-bg': tokens.palette.neutral.step5,
        '--_kbd-border': 'transparent',
        '--_kbd-color': `color-mix(in srgb, ${tokens.foreground.muted} 70%, transparent)`,
      },
    },
    '&[data-emphasis="low"], &[data-emphasis="minimal"]': {
      vars: {
        '--_kbd-bg': tokens.palette.neutral.step5,
        '--_kbd-border': 'transparent',
        '--_kbd-color': `color-mix(in srgb, ${tokens.foreground.muted} 70%, transparent)`,
      },
    },
    '&[data-kbd]:not([data-presentation="link"])[data-size="base"], &[data-kbd]:not([data-presentation="link"])[data-size="lg"]':
      {
        gap: tokens.space.step2,
        paddingRight: tokens.space.step1_5,
      },
    '&[data-kbd]:not([data-presentation="link"])[data-size="xs"]': {
      gap: '6px',
      paddingRight: '2.5px',
    },
    '&[data-kbd]:not([data-presentation="link"])[data-size="sm"]': {
      gap: '6px',
      paddingRight: tokens.space.step1,
    },
  },
});
