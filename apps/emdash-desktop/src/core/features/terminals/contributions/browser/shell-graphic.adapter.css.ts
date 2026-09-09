import { tokens } from '@emdash/theme';
import { hostAdapter } from '@emdash/ui/styles/host';

/** Rooted adapter for shell artwork imported as raw SVG markup. */
export const shellGraphicAdapter = hostAdapter({
  root: {
    display: 'inline-flex',
    width: '1rem',
    height: '1rem',
    flexShrink: 0,
    color: tokens.foreground.muted,
  },
  descendants: {
    '& > svg': {
      display: 'block',
      width: '100%',
      height: '100%',
    },
  },
});
