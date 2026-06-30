import { style } from '@vanilla-extract/css';

/** Scroll container: takes all available height, clips overflow. */
export const scrollContainer = style({
  minHeight: 0,
  flex: '1 1 0%',
  overflowY: 'auto',
  scrollbarWidth: 'none',
  selectors: {
    '&::-webkit-scrollbar': { display: 'none' },
  },
});

/** Absolute-positioned spacer that establishes total scroll height. */
export const spacer = style({
  position: 'relative',
});

/** Each virtual row is absolute inside the spacer. */
export const virtualRow = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
});

/** Trailing "Loading more…" indicator. */
export const loadingMore = style({
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  textAlign: 'center',
  fontSize: 'var(--text-xs)',
  color: 'var(--foreground-muted)',
});
