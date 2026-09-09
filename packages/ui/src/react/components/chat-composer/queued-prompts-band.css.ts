import { tokens } from '@emdash/theme';
import { style, sx } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const band = style([
  sx({
    display: 'flex',
    gap: tokens.space.step1_5,
    px: tokens.space.step2,
    py: tokens.space.step2,
  }),
  {
    position: 'relative',
    flexDirection: 'column',
    borderRadius: `${tokens.radius.xl} ${tokens.radius.xl} 0 0`,
    border: `1px solid ${tokens.border.default}`,
    borderBottomWidth: 0,
    backgroundColor: tokens.surface.current.background,
    color: tokens.foreground.default,
    fontSize: tokens.typography.size.xs,
  },
]);

export const bandConnectedBelow = style({
  selectors: {
    '&::after': {
      content: '',
      position: 'absolute',
      left: '-1px',
      right: '-1px',
      bottom: `calc(-1 * ${tokens.radius.xl})`,
      height: tokens.radius.xl,
      borderLeft: `1px solid ${tokens.border.default}`,
      borderRight: `1px solid ${tokens.border.default}`,
      pointerEvents: 'none',
    },
  },
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  paddingLeft: '0.25rem',
  paddingRight: '0.25rem',
  color: tokens.foreground.muted,
  lineHeight: 1.375,
});

export const headerStrong = style({
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
});

export const row = style({
  display: 'grid',
  position: 'relative',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  alignItems: 'center',
  gap: '0.5rem',
  minHeight: '1.875rem',
  borderRadius: tokens.radius.md,
  paddingLeft: '0.25rem',
  paddingRight: '0.25rem',
  outline: 'none',
  cursor: 'text',
  selectors: {
    '&:hover': { backgroundColor: tokens.surface.current.hover },
    '&:focus-within': { backgroundColor: tokens.surface.current.hover },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
    '&[data-dragging]': {
      opacity: 0.56,
    },
    '&[data-drag-over]': {
      backgroundColor: tokens.surface.current.selected,
    },
  },
});

export const indexSlot = style({
  position: 'relative',
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
});

export const indexNumber = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: tokens.foreground.muted,
  fontVariantNumeric: 'tabular-nums',
  transition: `opacity ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
  selectors: {
    [`${row}:hover &`]: { opacity: 0 },
    [`${row}:focus-within &`]: { opacity: 0 },
    [`${row}[data-dragging] &`]: { opacity: 0 },
  },
});

export const dragHandle = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 0,
  borderRadius: tokens.radius.sm,
  backgroundColor: 'transparent',
  padding: 0,
  color: tokens.foreground.muted,
  cursor: 'grab',
  opacity: 0,
  outline: 'none',
  transition: [
    `opacity ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
    `color ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
    `background-color ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
  ].join(', '),
  selectors: {
    [`${row}:hover &`]: { opacity: 1 },
    [`${row}:focus-within &`]: { opacity: 1 },
    [`${row}[data-dragging] &`]: { opacity: 1, cursor: 'grabbing' },
    '&:hover': {
      backgroundColor: tokens.surface.current.selected,
      color: tokens.foreground.default,
    },
    '&:focus-visible': {
      opacity: 1,
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
  },
});

export const dragHandleIcon = style({
  vars: {
    [iconSizeVar]: '0.875rem',
  },
});

export const promptText = style({
  minWidth: 0,
  border: 0,
  backgroundColor: 'transparent',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: 1.375,
  outline: 'none',
  cursor: 'text',
  selectors: {
    '&:focus-visible': {
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
    },
  },
});

export const emptyText = style({
  color: tokens.foreground.muted,
  fontStyle: 'italic',
});

export const actions = style({
  position: 'absolute',
  right: '0.125rem',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: '0.125rem',
  paddingLeft: '0.75rem',
  backgroundColor: tokens.surface.current.hover,
  opacity: 0,
  pointerEvents: 'none',
  transition: `opacity ${tokens.motion.duration.fast} ${tokens.motion.easing.standard}`,
  selectors: {
    [`${row}:hover &`]: { opacity: 1, pointerEvents: 'auto' },
    [`${row}:focus-within &`]: { opacity: 1, pointerEvents: 'auto' },
  },
});

export const editArea = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  minWidth: 0,
});

export const editInput = style({
  flex: 1,
  minWidth: 0,
  resize: 'vertical',
  maxHeight: '7rem',
  border: `1px solid ${tokens.border.default}`,
  borderRadius: tokens.radius.md,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  backgroundColor: tokens.surface.current.emphasis,
  color: tokens.foreground.default,
  font: 'inherit',
  lineHeight: 1.375,
  outline: 'none',
  selectors: {
    '&:focus': {
      borderColor: tokens.border.focus,
      boxShadow: `0 0 0 2px ${tokens.border.focus}`,
    },
  },
});
