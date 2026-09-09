import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const root = style({
  display: 'flex',
  width: '100%',
  height: '22.5rem',
  minHeight: '18rem',
  flexDirection: 'column',
  gap: tokens.space.step2,
  overflow: 'hidden',
  color: tokens.foreground.default,
});

export const header = style({
  display: 'flex',
  minWidth: 0,
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.space.step2,
});

export const headerEnd = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: tokens.space.step1,
});

export const selector = style({
  minWidth: 0,
  maxWidth: '14rem',
});

export const selectorText = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const taskName = style({
  display: 'grid',
  flexShrink: 0,
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  alignItems: 'center',
  gap: tokens.space.step2,
});

export const taskNameLabel = style({
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
  fontWeight: 500,
});

export const taskNameInput = style({
  appearance: 'none',
  flex: 1,
  width: '100%',
  minWidth: 0,
  border: 0,
  backgroundColor: 'transparent',
  color: tokens.foreground.default,
  padding: 0,
  font: 'inherit',
  fontSize: tokens.typography.size.sm,
  fontWeight: 500,
  outline: 'none',
  selectors: {
    '&::placeholder': { color: tokens.foreground.passive },
  },
});

export const taskNameControl = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: tokens.space.step2,
});

export const taskNameError = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: tokens.space.step1,
  color: tokens.palette.red.step11,
  fontSize: tokens.typography.size.xs,
});

export const footer = style({
  display: 'flex',
  minWidth: 0,
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.space.step2,
});

export const footerStart = style({
  display: 'flex',
  minWidth: 0,
  flex: 1,
  alignItems: 'center',
  gap: tokens.space.step1,
});

export const footerEnd = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: tokens.space.step1,
});

export const flexibleSelector = style({
  minWidth: '2.25rem',
  maxWidth: '9rem',
});

export const popup = style({
  width: '23rem',
  maxHeight: '19rem',
});

export const workspacePopup = style({
  width: '34rem',
  maxWidth: 'calc(100vw - 2rem)',
  height: '23rem',
  maxHeight: 'calc(100vh - 2rem)',
});

export const popupHeader = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.space.step2,
  padding: tokens.space.step2,
});

export const popupBody = style({
  minHeight: 0,
  flex: 1,
  overflowY: 'auto',
  padding: tokens.space.step1,
});

export const popupFooter = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: tokens.space.step1,
});

export const comboboxHeader = style({
  padding: tokens.space.step2,
  color: tokens.foreground.default,
  fontSize: tokens.typography.size.sm,
  fontWeight: 600,
});

export const comboboxFooter = style({
  display: 'flex',
  padding: tokens.space.step1,
});

export const search = style({
  margin: tokens.space.step1,
});

export const itemContent = style({
  display: 'flex',
  minWidth: 0,
  flex: 1,
  flexDirection: 'column',
});

export const itemLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const itemDescription = style({
  minWidth: 0,
  overflow: 'hidden',
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const state = style({
  display: 'grid',
  minHeight: '6rem',
  placeItems: 'center',
  gap: tokens.space.step2,
  padding: tokens.space.step4,
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.sm,
  textAlign: 'center',
});

export const retry = style({
  marginInline: 'auto',
});

export const workspaceBody = style({
  display: 'grid',
  minHeight: 0,
  flex: 1,
  gridTemplateColumns: '10.5rem minmax(0, 1fr)',
  overflow: 'hidden',
});

export const presetRail = style({
  width: '100%',
  minHeight: 0,
  overflowY: 'auto',
  padding: tokens.space.step1,
});

export const preset = style({
  width: '100%',
});

export const presetLabel = style({
  width: '100%',
  textAlign: 'start',
});

export const detail = style({
  minHeight: 0,
  overflowY: 'auto',
  padding: tokens.space.step3,
});

export const detailStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space.step3,
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space.step1,
});

export const fieldLabel = style({
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
});

export const inline = style({
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space.step2,
});

export const notice = style({
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  padding: tokens.space.step2,
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
});

export const error = style({
  color: tokens.surface.tone.destructive.foreground,
});

export const destination = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: tokens.space.step2,
  padding: tokens.space.step2,
  backgroundColor: tokens.surface.current.hover,
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
});

export const destinationStatus = style({
  marginInlineStart: 'auto',
});

export const setupList = style({
  margin: 0,
  paddingInlineStart: tokens.space.step4,
  color: tokens.foreground.muted,
  fontSize: tokens.typography.size.xs,
});

export const radioDock = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: '1px',
});

export const visuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});
