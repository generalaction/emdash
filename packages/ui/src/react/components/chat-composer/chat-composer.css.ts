import { tokens } from '@emdash/theme';
import { cx, recipe, style, sx } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';
import { surface } from '@styles/recipes/surface';

export const composerRoot = cx(
  surface({ level: 'base' }),
  sx({ display: 'flex' }),
  style({
    flexDirection: 'column',
    fontFamily: tokens.typography.family.sans,
  })
);

export const noticeBand = recipe({
  base: [
    sx({
      display: 'flex',
      alignItems: 'start',
      gap: tokens.space.step2,
      px: tokens.space.step3,
      py: tokens.space.step2,
    }),
    {
      borderRadius: `${tokens.radius.xl} ${tokens.radius.xl} 0 0`,
      border: '1px solid',
      borderBottomWidth: 0,
      fontSize: tokens.typography.size.xs,
    },
  ],
  variants: {
    variant: {
      error: {
        backgroundColor: tokens.surface.tone.destructive.background,
        borderColor: tokens.surface.tone.destructive.border,
        color: tokens.surface.tone.destructive.foreground,
      },
      warning: {
        backgroundColor: tokens.surface.tone.warning.background,
        borderColor: tokens.surface.tone.warning.border,
        color: tokens.surface.tone.warning.foreground,
      },
      info: {
        backgroundColor: tokens.surface.tone.info.background,
        borderColor: tokens.surface.tone.info.border,
        color: tokens.surface.tone.info.foreground,
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
  fontSize: tokens.typography.size.sm,
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
  transition: `opacity ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
  selectors: {
    '&:hover': { opacity: 1 },
    '&:focus-visible': {
      borderRadius: tokens.radius.sm,
      outline: `2px solid ${tokens.border.focus}`,
      outlineOffset: 1,
    },
  },
});

export const noticeAnimWrapper = style({
  display: 'grid',
  transition: [
    `grid-template-rows ${tokens.motion.duration.normal} ${tokens.motion.easing.standard}`,
    `opacity ${tokens.motion.duration.normal} ${tokens.motion.easing.standard}`,
  ].join(', '),
});

export const noticeAnimVisible = style({ gridTemplateRows: '1fr', opacity: 1 });
export const noticeAnimHidden = style({ gridTemplateRows: '0fr', opacity: 0 });

export const noticeOverflowClip = style({ overflow: 'hidden' });

// ── Composer shell ────────────────────────────────────────────────────────────

export const composerShell = recipe({
  base: [
    sx({ display: 'flex', gap: tokens.space.step0 }),
    {
      backgroundColor: tokens.surface.current.emphasis,
      flexDirection: 'column',
      border: `1px solid ${tokens.border.default}`,
      color: tokens.foreground.default,
      transition: [
        `border-color ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
        `background-color ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
        `box-shadow ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
      ].join(', '),
      selectors: {
        '&:hover': { borderColor: tokens.border.muted },
        '&:focus-within': {
          borderColor: tokens.border.focus,
          boxShadow: `0 0 0 2px ${tokens.border.focus}`,
        },
      },
    },
  ],
  variants: {
    hasBand: {
      true: { borderRadius: `0 0 ${tokens.radius.xl} ${tokens.radius.xl}` },
      false: { borderRadius: tokens.radius.xl },
    },
    dragActive: {
      true: {
        borderColor: tokens.border.focus,
        boxShadow: `0 0 0 2px ${tokens.border.focus}`,
      },
      false: {},
    },
    disabled: {
      true: {
        borderColor: tokens.border.subtle,
        backgroundColor: tokens.surface.level.sunken.background,
        color: tokens.foreground.muted,
        boxShadow: 'none',
        cursor: 'not-allowed',
        opacity: 0.64,
      },
      false: {},
    },
  },
  defaultVariants: { hasBand: false, dragActive: false, disabled: false },
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
  borderRadius: tokens.radius.md,
  outline: 'none',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${tokens.border.focus}`,
      outlineOffset: 1,
    },
  },
});

export const attachmentThumbImg = style({
  width: '2rem',
  height: '2rem',
  borderRadius: tokens.radius.md,
  objectFit: 'cover',
  boxShadow: `0 0 0 1px ${tokens.border.default}`,
});

export const attachmentRemoveBtn = style({
  position: 'absolute',
  top: '-0.375rem',
  right: '-0.375rem',
  display: 'grid',
  placeItems: 'center',
  width: '1rem',
  height: '1rem',
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.surface.current.background,
  color: tokens.foreground.default,
  opacity: 0,
  boxShadow: `0 0 0 1px ${tokens.border.default}`,
  transition: `opacity ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
  vars: {
    [iconSizeVar]: '0.625rem',
  },
  selectors: {
    // Show on hover of parent thumb
    '[data-attachment-thumb]:hover &': { opacity: 1 },
    '&:focus-visible': {
      opacity: 1,
      outline: `2px solid ${tokens.border.focus}`,
      outlineOffset: 1,
    },
  },
});

// ── Editor area ───────────────────────────────────────────────────────────────

export const editorArea = style({
  maxHeight: '200px',
  overflowY: 'auto',
  paddingLeft: '0.75rem',
  paddingRight: '0.75rem',
  paddingTop: '0.75rem',
  paddingBottom: '0.5rem',
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

export const permissionModeTrigger = style({
  paddingLeft: '0.1875rem',
  paddingRight: '0.1875rem',
});

export const selectedModelEffort = style({
  color: tokens.foreground.muted,
});

export const mcpTrigger = style({
  display: 'inline-flex',
  height: '1.75rem',
  alignItems: 'center',
  gap: '0.25rem',
  borderRadius: tokens.radius.md,
  paddingLeft: '0.1875rem',
  paddingRight: '0.1875rem',
  color: tokens.foreground.default,
  fontSize: tokens.typography.size.xs,
  lineHeight: 1,
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: tokens.surface.current.selected },
    '&[data-popup-open]': { backgroundColor: tokens.surface.current.selected },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
});

export const mcpPopoverContent = style({
  width: '16rem',
  padding: '0.5rem',
});

export const mcpList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
});

export const mcpRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  borderRadius: tokens.radius.md,
  padding: '0.375rem 0.5rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
});

export const mcpName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const mcpBadge = style({
  flexShrink: 0,
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.border.default}`,
  padding: '0.0625rem 0.3125rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

// ── Agent trigger ─────────────────────────────────────────────────────────────

export const agentTrigger = style({
  display: 'flex',
  width: '1.75rem',
  height: '1.75rem',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.md,
  border: '1px solid transparent',
  color: tokens.foreground.default,
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: tokens.surface.current.selected },
    '&[data-popup-open]': { backgroundColor: tokens.surface.current.selected },
    '&:focus-visible': {
      borderColor: tokens.border.focus,
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
  },
});

export const agentIconPlaceholder = style({
  width: '1rem',
  height: '1rem',
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.border.default,
});

// ── Model detail card ─────────────────────────────────────────────────────────

export const modelDetailCard = style({
  width: '14rem',
  padding: '0.75rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
});

export const modelDetailName = style({
  lineHeight: 1.25,
  fontWeight: 400,
});

export const modelDetailDesc = style({
  marginTop: '0.25rem',
  fontSize: tokens.typography.size.xs,
  lineHeight: 1.375,
  color: tokens.foreground.muted,
});

export const modelDetailFeatures = style({
  marginTop: '0.5rem',
  borderTop: `1px solid ${tokens.border.default}`,
  paddingTop: '0.5rem',
});

export const modelDetailRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  fontSize: tokens.typography.size.xs,
});

export const modelDetailLabel = style({ color: tokens.foreground.muted });
export const modelDetailValue = style({ color: tokens.foreground.default });

export const barMeter = style({ display: 'flex', alignItems: 'center', gap: '0.125rem' });

/** Send button override — fully rounded pill shape. */
export const sendButtonRound = style({ borderRadius: tokens.radius.full });

export const stopIcon = style({
  width: '0.5rem',
  height: '0.5rem',
  borderRadius: '0.0625rem',
  backgroundColor: 'currentColor',
});

// ── Context usage indicator ────────────────────────────────────────────────────

/** Donut SVG container — sized to match other toolbar icons. */
export const donut = style({
  width: '1rem',
  height: '1rem',
  display: 'block',
  overflow: 'visible',
});

/** Background track ring. */
export const donutTrack = style({ stroke: tokens.border.default });

/** Foreground fill ring — normal state. */
export const donutProgress = style({ stroke: tokens.foreground.default });

/** Foreground fill ring — warning state (>= 90% full). */
export const donutProgressWarn = style({ stroke: tokens.surface.tone.warning.foreground });

/** Cost row shown below the description in the popover when cost is available. */
export const usageCostRow = style({
  marginTop: '0.625rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const usagePopoverBody = style({
  width: '16rem',
});

export const usageStatsRow = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '1rem',
  fontSize: tokens.typography.size.xs,
});

export const usagePercent = style({
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const usageTokenCount = style({
  color: tokens.foreground.muted,
  whiteSpace: 'nowrap',
});

export const usageBarTrack = style({
  marginTop: '0.5rem',
  height: '0.375rem',
  overflow: 'hidden',
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.border.default,
});

export const usageBarFill = style({
  height: '100%',
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.foreground.default,
});

export const usageBarFillWarn = style({
  backgroundColor: tokens.surface.tone.warning.foreground,
});

export const barDotFilled = style({
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: tokens.radius.full,
  background: tokens.foreground.muted,
});

export const barDotEmpty = style({
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: tokens.radius.full,
  background: tokens.border.default,
});

// ── Effort row (footer inside the model popover) ───────────────────────────────

/**
 * Full-width row rendered in the model popover footer that acts as the trigger
 * for the effort/thought-level submenu flyout.
 */
export const effortRow = style({
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  borderRadius: tokens.radius.md,
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
  background: 'transparent',
  border: 'none',
  cursor: 'default',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: tokens.surface.current.hover },
    '&[data-popup-open]': { backgroundColor: tokens.surface.current.hover },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
  },
});

export const effortRowLabel = style({
  color: tokens.foreground.default,
});

export const effortRowValue = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
});
