import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';

export const composerRoot = style({
  display: 'flex',
  flexDirection: 'column',
});

export const noticeBand = recipe({
  base: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
    border: '1px solid',
    borderBottomWidth: 0,
    paddingLeft: '0.75rem',
    paddingRight: '0.75rem',
    paddingTop: '0.5rem',
    paddingBottom: '0.5rem',
    fontSize: 'var(--text-xs)',
  },
  variants: {
    variant: {
      error: {
        backgroundColor: vars.surfaceDestructive,
        borderColor: vars.surfaceDestructiveBorder,
        color: vars.surfaceDestructiveForeground,
      },
      warning: {
        backgroundColor: vars.surfaceWarning,
        borderColor: vars.surfaceWarningBorder,
        color: vars.surfaceWarningForeground,
      },
      info: {
        backgroundColor: vars.surfaceInfo,
        borderColor: vars.surfaceInfoBorder,
        color: vars.surfaceInfoForeground,
      },
    },
  },
  defaultVariants: { variant: 'info' },
});

export const noticeBandBody = style({ flex: 1 });

export const noticeBandHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
});

export const noticeBandTitle = style({
  fontSize: 'var(--text-sm)',
  lineHeight: 1.375,
});

export const noticeBandMessage = style({ lineHeight: 1.375 });

export const noticeBandMessageIndented = style({
  marginTop: '0.25rem',
  opacity: 0.8,
});

export const noticeDismiss = style({
  marginLeft: '0.25rem',
  flexShrink: 0,
  opacity: 0.7,
  transition: 'opacity 150ms',
  selectors: {
    '&:hover': { opacity: 1 },
  },
});

export const noticeAnimWrapper = style({
  display: 'grid',
  transition: 'grid-template-rows 200ms ease-out, opacity 200ms ease-out',
});

export const noticeAnimVisible = style({ gridTemplateRows: '1fr', opacity: 1 });
export const noticeAnimHidden = style({ gridTemplateRows: '0fr', opacity: 0 });

export const noticeOverflowClip = style({ overflow: 'hidden' });

// ── Composer shell ────────────────────────────────────────────────────────────

export const composerShell = recipe({
  base: {
    // Host-overridable via `--composer-bg`; defaults to the elevated surface.
    backgroundColor: `var(--composer-bg, ${vars.surfaceBaseEmphasis})`,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    border: `1px solid ${vars.border}`,
    transition: 'border-color 150ms',
    selectors: {
      '&:hover': { borderColor: vars.border1 },
      '&:focus-within': {
        borderColor: vars.border1,
        boxShadow: `0 0 0 1px ${vars.border1}`,
      },
    },
  },
  variants: {
    hasBand: {
      true: { borderRadius: '0 0 var(--radius-xl) var(--radius-xl)' },
      false: { borderRadius: 'var(--radius-xl)' },
    },
    dragActive: {
      true: {
        borderColor: vars.border1,
        boxShadow: `0 0 0 1px ${vars.border1}`,
      },
      false: {},
    },
  },
  defaultVariants: { hasBand: false, dragActive: false },
});

// ── Image attachments ─────────────────────────────────────────────────────────

export const attachmentStrip = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  paddingLeft: '0.75rem',
  paddingRight: '0.75rem',
  paddingTop: '0.75rem',
});

export const attachmentThumb = style({
  position: 'relative',
  width: '2rem',
  height: '2rem',
});

export const attachmentThumbBtn = style({
  display: 'block',
  width: '2rem',
  height: '2rem',
  padding: 0,
  borderRadius: 'var(--radius-md)',
  selectors: {
    '&:focus-visible': { outlineWidth: 2, outlineOffset: 1 },
  },
});

export const attachmentThumbImg = style({
  width: '2rem',
  height: '2rem',
  borderRadius: 'var(--radius-md)',
  objectFit: 'cover',
  boxShadow: `0 0 0 1px ${vars.border}`,
});

export const attachmentRemoveBtn = style({
  position: 'absolute',
  top: '-0.375rem',
  right: '-0.375rem',
  display: 'grid',
  placeItems: 'center',
  width: '1rem',
  height: '1rem',
  borderRadius: '9999px',
  backgroundColor: vars.surface,
  color: vars.foreground,
  opacity: 0,
  boxShadow: `0 0 0 1px ${vars.border}`,
  transition: 'opacity 150ms',
  selectors: {
    // Show on hover of parent thumb
    '[data-attachment-thumb]:hover &': { opacity: 1 },
  },
});

// ── Editor area ───────────────────────────────────────────────────────────────

export const editorArea = style({
  maxHeight: '200px',
  overflowY: 'auto',
  paddingLeft: '0.75rem',
  paddingRight: '0.75rem',
  paddingTop: '0.75rem',
  paddingBottom: '0.25rem',
});

// ── Toolbar ───────────────────────────────────────────────────────────────────

export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.25rem',
  paddingBottom: '0.5rem',
});

export const toolbarLeft = style({ display: 'flex', alignItems: 'center', gap: '0.375rem' });
export const toolbarRight = style({ display: 'flex', alignItems: 'center', gap: '0.25rem' });

// ── Agent trigger ─────────────────────────────────────────────────────────────

export const agentTrigger = style({
  display: 'flex',
  width: '1.75rem',
  height: '1.75rem',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-md)',
  border: '1px solid transparent',
  color: vars.foreground,
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: vars.surfaceHover },
    '&[data-popup-open]': { backgroundColor: vars.surfaceHover },
  },
});

export const agentIconPlaceholder = style({
  width: '1rem',
  height: '1rem',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: vars.border,
});

// ── Model detail card ─────────────────────────────────────────────────────────

export const modelDetailCard = style({
  width: '14rem',
  padding: '0.75rem',
  fontSize: 'var(--text-sm)',
  color: vars.foreground,
});

export const modelDetailName = style({
  lineHeight: 1.25,
  fontWeight: 500,
});

export const modelDetailDesc = style({
  marginTop: '0.25rem',
  fontSize: 'var(--text-xs)',
  lineHeight: 1.375,
  color: vars.foregroundMuted,
});

export const modelDetailFeatures = style({
  marginTop: '0.5rem',
  borderTop: `1px solid ${vars.border}`,
  paddingTop: '0.5rem',
});

export const modelDetailRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  fontSize: 'var(--text-xs)',
});

export const modelDetailLabel = style({ color: vars.foregroundMuted });
export const modelDetailValue = style({ color: vars.foreground });

export const barMeter = style({ display: 'flex', alignItems: 'center', gap: '0.125rem' });

/** Send button override — fully rounded pill shape. */
export const sendButtonRound = style({ borderRadius: '9999px' });

export const barDotFilled = style({
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: '9999px',
  background: 'var(--foreground-muted)',
});

export const barDotEmpty = style({
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: '9999px',
  background: 'var(--border)',
});
