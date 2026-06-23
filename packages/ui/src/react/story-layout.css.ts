/**
 * story-layout.css.ts — Vanilla Extract layout helpers for Storybook stories.
 *
 * Replaces the plain-CSS `stories.css` shim. All class names are VE-generated
 * opaque hashes — no Tailwind-shaped utility names remain in the DOM.
 * NOT shipped in the production build (tree-shaken; only story files import this).
 */

import { style } from '@vanilla-extract/css';

// ── Display ───────────────────────────────────────────────────────────────────

export const flex = style({ display: 'flex' });
export const inlineFlex = style({ display: 'inline-flex' });
export const grid = style({ display: 'grid' });
export const relative = style({ position: 'relative' });
export const absolute = style({ position: 'absolute' });
export const inset0 = style({ inset: 0 });
export const insetX0 = style({ left: 0, right: 0 });
export const bottom0 = style({ bottom: 0 });
export const negTop2 = style({ top: '-0.5rem' });
export const left50pct = style({ left: '50%' });
export const negTranslateX = style({ transform: 'translateX(-50%)' });
export const negTranslateY = style({ transform: 'translateY(-100%)' });

// ── Flex direction / wrapping ─────────────────────────────────────────────────

export const flexCol = style({ flexDirection: 'column' });
export const flexWrap = style({ flexWrap: 'wrap' });

// ── Flex / shrink ─────────────────────────────────────────────────────────────

export const flex1 = style({ flex: '1 1 0%' });
export const shrink0 = style({ flexShrink: 0 });
export const flexGrow = style({ flexGrow: 1 });
export const minW0 = style({ minWidth: 0 });

// ── Align / justify ───────────────────────────────────────────────────────────

export const itemsStart = style({ alignItems: 'flex-start' });
export const itemsCenter = style({ alignItems: 'center' });
export const itemsEnd = style({ alignItems: 'flex-end' });
export const itemsBaseline = style({ alignItems: 'baseline' });
export const itemsStretch = style({ alignItems: 'stretch' });
export const justifyCenter = style({ justifyContent: 'center' });
export const justifyBetween = style({ justifyContent: 'space-between' });
export const justifyEnd = style({ justifyContent: 'flex-end' });

// ── Grid columns ──────────────────────────────────────────────────────────────

export const cols1 = style({ gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' });
export const cols2 = style({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' });
export const cols3 = style({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' });
export const cols4 = style({ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' });
export const cols5 = style({ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' });
export const cols12 = style({ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' });

// ── Gap ───────────────────────────────────────────────────────────────────────

export const gap0 = style({ gap: 0 });
export const gapHalf = style({ gap: '0.125rem' });
export const gap1 = style({ gap: '0.25rem' });
export const gap15 = style({ gap: '0.375rem' });
export const gap2 = style({ gap: '0.5rem' });
export const gap3 = style({ gap: '0.75rem' });
export const gap4 = style({ gap: '1rem' });
export const gap6 = style({ gap: '1.5rem' });
export const gap8 = style({ gap: '2rem' });

// ── Padding ───────────────────────────────────────────────────────────────────

export const p3 = style({ padding: '0.75rem' });
export const p4 = style({ padding: '1rem' });
export const p6 = style({ padding: '1.5rem' });
export const p8 = style({ padding: '2rem' });

export const px1 = style({ paddingLeft: '0.25rem', paddingRight: '0.25rem' });
export const px2 = style({ paddingLeft: '0.5rem', paddingRight: '0.5rem' });
export const px25 = style({ paddingLeft: '0.625rem', paddingRight: '0.625rem' });
export const px3 = style({ paddingLeft: '0.75rem', paddingRight: '0.75rem' });
export const px6 = style({ paddingLeft: '1.5rem', paddingRight: '1.5rem' });

export const py1 = style({ paddingTop: '0.25rem', paddingBottom: '0.25rem' });
export const py15 = style({ paddingTop: '0.375rem', paddingBottom: '0.375rem' });
export const py2 = style({ paddingTop: '0.5rem', paddingBottom: '0.5rem' });
export const py3 = style({ paddingTop: '0.75rem', paddingBottom: '0.75rem' });

export const pt1 = style({ paddingTop: '0.25rem' });
export const pt2 = style({ paddingTop: '0.5rem' });
export const pt3 = style({ paddingTop: '0.75rem' });
export const pb1 = style({ paddingBottom: '0.25rem' });
export const pb2 = style({ paddingBottom: '0.5rem' });

// ── Margin ────────────────────────────────────────────────────────────────────

export const mxAuto = style({ marginLeft: 'auto', marginRight: 'auto' });
export const mb1 = style({ marginBottom: '0.25rem' });
export const mb2 = style({ marginBottom: '0.5rem' });
export const mb3 = style({ marginBottom: '0.75rem' });
export const mb4 = style({ marginBottom: '1rem' });
export const ml2 = style({ marginLeft: '0.5rem' });
export const mt05 = style({ marginTop: '0.125rem' });
export const mt1 = style({ marginTop: '0.25rem' });
export const mt15 = style({ marginTop: '0.375rem' });
export const mt2 = style({ marginTop: '0.5rem' });
export const mt3 = style({ marginTop: '0.75rem' });
export const mt4 = style({ marginTop: '1rem' });

// ── Width ─────────────────────────────────────────────────────────────────────

export const w12 = style({ width: '3rem' });
export const w16 = style({ width: '4rem' });
export const w36 = style({ width: '9rem' });
export const w40 = style({ width: '10rem' });
export const w44 = style({ width: '11rem' });
export const w48 = style({ width: '12rem' });
export const w52 = style({ width: '13rem' });
export const w64 = style({ width: '16rem' });
export const w72 = style({ width: '18rem' });
export const w80 = style({ width: '20rem' });
export const wFull = style({ width: '100%' });
export const maxW2xl = style({ maxWidth: '42rem' });
export const maxWProse = style({ maxWidth: '65ch' });

// ── Height ────────────────────────────────────────────────────────────────────

export const h6 = style({ height: '1.5rem' });
export const h7 = style({ height: '1.75rem' });
export const h8 = style({ height: '2rem' });
export const h10 = style({ height: '2.5rem' });
export const h16 = style({ height: '4rem' });
export const h40 = style({ height: '10rem' });
export const h48 = style({ height: '12rem' });
export const hFull = style({ height: '100%' });
export const hScreen = style({ height: '100vh' });
export const minHScreen = style({ minHeight: '100vh' });
export const maxH50vh = style({ maxHeight: '50vh' });

// ── Size (square) ─────────────────────────────────────────────────────────────

export const size15 = style({ width: '0.375rem', height: '0.375rem' });
export const size3 = style({ width: '0.75rem', height: '0.75rem' });
export const size35 = style({ width: '0.875rem', height: '0.875rem' });
export const size4 = style({ width: '1rem', height: '1rem' });

// ── Overflow ──────────────────────────────────────────────────────────────────

export const overflowHidden = style({ overflow: 'hidden' });
export const overflowAuto = style({ overflow: 'auto' });
export const truncate = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const noWrap = style({ whiteSpace: 'nowrap' });

// ── Background ────────────────────────────────────────────────────────────────

export const bgBackground = style({ backgroundColor: 'var(--background)' });
export const bgBackground2 = style({ backgroundColor: 'var(--background-2)' });
export const bgSurface = style({ backgroundColor: 'var(--surface)' });
export const bgSurface80 = style({
  backgroundColor: 'color-mix(in srgb, var(--surface) 80%, transparent)',
});
export const bgSurfaceSunken = style({ backgroundColor: 'var(--surface-sunken)' });
export const bgSurfaceBase = style({ backgroundColor: 'var(--surface-base)' });
export const bgSurfaceBaseEmphasis = style({ backgroundColor: 'var(--surface-base-emphasis)' });
export const bgSurfaceHover = style({ backgroundColor: 'var(--surface-hover)' });
export const bgSurfaceSelected = style({ backgroundColor: 'var(--surface-selected)' });
export const bgSurfaceElevated = style({ backgroundColor: 'var(--surface-elevated)' });
export const bgSurfacePaper = style({ backgroundColor: 'var(--surface-paper)' });

// ── Text color ────────────────────────────────────────────────────────────────

export const textForeground = style({ color: 'var(--foreground)' });
export const textForegroundMuted = style({ color: 'var(--foreground-muted)' });
export const textForegroundPassive = style({ color: 'var(--foreground-passive)' });

// ── Text size ─────────────────────────────────────────────────────────────────

export const textXs = style({
  fontSize: 'var(--text-xs)',
  lineHeight: 'var(--text-xs--line-height)',
});
export const textSm = style({
  fontSize: 'var(--text-sm)',
  lineHeight: 'var(--text-sm--line-height)',
});
export const text9px = style({ fontSize: '9px' });
export const text10px = style({ fontSize: '10px' });
export const text11px = style({ fontSize: '11px' });
export const text13px = style({ fontSize: '13px' });

// ── Text alignment ────────────────────────────────────────────────────────────

export const textCenter = style({ textAlign: 'center' });
export const textLeft = style({ textAlign: 'left' });
export const textRight = style({ textAlign: 'right' });

// ── Font ──────────────────────────────────────────────────────────────────────

export const fontMedium = style({ fontWeight: 500 });
export const fontSemibold = style({ fontWeight: 600 });
export const fontMono = style({ fontFamily: 'var(--font-mono)' });
export const italic = style({ fontStyle: 'italic' });
export const underline = style({ textDecorationLine: 'underline' });
export const uppercase = style({ textTransform: 'uppercase' });
export const trackingWider = style({ letterSpacing: '0.05em' });
export const leadingNone = style({ lineHeight: '1' });
export const leadingSnug = style({ lineHeight: '1.375' });
export const leadingTight = style({ lineHeight: '1.25' });

// ── Border ────────────────────────────────────────────────────────────────────

export const border = style({ borderWidth: '1px', borderStyle: 'solid' });
export const border2 = style({ borderWidth: '2px', borderStyle: 'solid' });
export const borderT = style({ borderTopWidth: '1px', borderTopStyle: 'solid' });
export const borderB = style({ borderBottomWidth: '1px', borderBottomStyle: 'solid' });
export const borderBorder = style({ borderColor: 'var(--border)' });
export const borderTransparent = style({ borderColor: 'transparent' });
export const outlineNone = style({ outline: 'none' });

export const divideX = style({
  selectors: {
    '& > * + *': { borderLeftWidth: '1px', borderLeftStyle: 'solid' },
  },
});
export const divideBorder = style({
  selectors: {
    '& > * + *': { borderColor: 'var(--border)' },
  },
});

// ── Border radius ─────────────────────────────────────────────────────────────

export const rounded = style({ borderRadius: 'var(--radius-sm)' });
export const roundedMd = style({ borderRadius: 'var(--radius-md)' });
export const roundedLg = style({ borderRadius: 'var(--radius-lg)' });
export const roundedXl = style({ borderRadius: 'var(--radius-xl)' });
export const roundedFull = style({ borderRadius: '9999px' });
export const roundedBLg = style({
  borderBottomLeftRadius: 'var(--radius-lg)',
  borderBottomRightRadius: 'var(--radius-lg)',
});

// ── Shadow ────────────────────────────────────────────────────────────────────

export const shadowMd = style({
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
});
export const backdropBlurSm = style({ backdropFilter: 'blur(4px)' });

// ── Misc ──────────────────────────────────────────────────────────────────────

export const transitionAll = style({ transition: 'all 150ms' });

// ── Vertical spacing ──────────────────────────────────────────────────────────

export const spaceY15 = style({
  selectors: { '& > * + *': { marginTop: '0.375rem' } },
});
export const spaceY4 = style({
  selectors: { '& > * + *': { marginTop: '1rem' } },
});
export const spaceY6 = style({
  selectors: { '& > * + *': { marginTop: '1.5rem' } },
});

// ── Interactive tab / button states used in surface-cascade stories ───────────

export const storyTabButton = style({
  display: 'inline-flex',
  height: '1.75rem',
  alignItems: 'center',
  gap: '0.375rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid transparent',
  paddingLeft: '0.625rem',
  paddingRight: '0.625rem',
  fontSize: 'var(--text-sm)',
  color: 'var(--foreground-muted)',
  transition: 'all 150ms',
  ':hover': {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--foreground)',
  },
  selectors: {
    '&[data-active="true"]': {
      backgroundColor: 'var(--surface-selected)',
      color: 'var(--foreground)',
    },
  },
});

// ── Responsive grid variants ──────────────────────────────────────────────────

export const lgCols2 = style({
  '@media': {
    '(min-width: 1024px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
});
export const lgCols3 = style({
  '@media': {
    '(min-width: 1024px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
});
export const lgCols7 = style({
  '@media': {
    '(min-width: 1024px)': { gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' },
  },
});
