import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const root = style({
  position: 'relative',
  display: 'flex',
  minHeight: 0,
  flex: 1,
  flexDirection: 'column',
  overflow: 'hidden',
});

export const editor = style({
  minHeight: '7rem',
  flex: 1,
  overflowY: 'auto',
  paddingBlock: tokens.space.step2,
});

export const readOnlyReason = style({
  flexShrink: 0,
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
});

export const completionStatus = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: tokens.space.step2,
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  padding: tokens.space.step2,
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});

export const fileMentions = style({
  display: 'flex',
  flexShrink: 0,
  flexWrap: 'wrap',
  gap: tokens.space.step1,
  paddingBlockEnd: tokens.space.step1,
});

export const fileMention = style({
  display: 'inline-flex',
  maxWidth: '14rem',
  alignItems: 'center',
  gap: tokens.space.step1,
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  padding: `${tokens.space.step1} ${tokens.space.step2}`,
  color: tokens.foreground.default,
  fontSize: tokens.typography.size.xs,
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});

export const resourceName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const resourceError = style({
  color: tokens.surface.tone.destructive.foreground,
});

export const imageShelf = style({
  display: 'flex',
  minHeight: 0,
  flexShrink: 0,
  gap: tokens.space.step2,
  overflowX: 'auto',
  paddingBlock: tokens.space.step1,
});

export const image = style({
  position: 'relative',
  display: 'grid',
  width: '8.5rem',
  height: '3.75rem',
  flexShrink: 0,
  gridTemplateColumns: '3.25rem minmax(0, 1fr)',
  alignItems: 'center',
  gap: tokens.space.step1,
  overflow: 'hidden',
  border: `1px solid ${tokens.border.default}`,
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.surface.current.background,
  padding: tokens.space.step1,
  color: tokens.foreground.default,
});

export const thumbnail = style({
  width: '3.25rem',
  height: '3.25rem',
  borderRadius: tokens.radius.sm,
  objectFit: 'cover',
});

export const imagePlaceholder = style({
  display: 'grid',
  width: '3.25rem',
  height: '3.25rem',
  placeItems: 'center',
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  color: tokens.foreground.muted,
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});

export const imageActions = style({
  position: 'absolute',
  insetBlockStart: tokens.space.step1,
  insetInlineEnd: tokens.space.step1,
  display: 'flex',
  gap: tokens.space.step1,
});

export const dropOverlay = style({
  pointerEvents: 'none',
  position: 'absolute',
  zIndex: 2,
  inset: tokens.space.step1,
  display: 'grid',
  placeItems: 'center',
  border: `1px dashed ${tokens.border.focus}`,
  borderRadius: tokens.radius.md,
  backgroundColor: `color-mix(in srgb, ${tokens.surface.current.background} 88%, transparent)`,
  color: tokens.foreground.default,
  fontSize: tokens.typography.size.sm,
});
