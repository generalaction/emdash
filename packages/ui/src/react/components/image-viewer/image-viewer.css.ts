import { tokens } from '@emdash/theme';
import { style, sx } from '@styles/index';

// ── ZoomViewerDialog ──────────────────────────────────────────────────────────

export const toolbarRow = style({
  display: 'flex',
  flexShrink: 0,
  justifyContent: 'flex-end',
  padding: '0.75rem',
  paddingBottom: '0.5rem',
});

export const toolbarGroup = style({
  display: 'flex',
  alignItems: 'center',
  overflow: 'hidden',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: tokens.surface.current.background,
  boxShadow: tokens.shadow.sm,
});

// Buttons sit flush inside the bordered group; the group's overflow clipping
// owns the outer corner rounding. Radius removal must go through the
// utilities layer to win over the control recipe.
export const toolbarButton = sx({ borderRadius: '0' });

export const viewerBody = style({
  minHeight: 0,
  flex: 1,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingBottom: '0.5rem',
});

// Sizing is owned by the inline wrapperStyle passed to TransformComponent
// (react-zoom-pan-pinch defaults the wrapper to fit-content otherwise).
export const transformWrapper = style({
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.palette.neutral.step2,
});

export const unavailable = style({
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});

export const unavailableContainer = style({
  display: 'flex',
  minHeight: 0,
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  paddingTop: 0,
});

// ── ContainedImage / ExpandableImage ─────────────────────────────────────────

export const containedImage = style({
  objectFit: 'contain',
});

// Inside the zoom dialog the image renders at natural size; the transform
// wrapper owns scaling, so viewport-relative caps must come off.
export const zoomTargetImage = style({
  display: 'block',
  height: 'auto',
  maxHeight: 'none',
  maxWidth: 'none',
});

export const expandableContainer = style({
  position: 'relative',
  display: 'inline-block',
  maxWidth: '100%',
  verticalAlign: 'top',
});

export const expandButton = style({
  position: 'absolute',
  top: '0.25rem',
  right: '0.25rem',
  zIndex: 10,
  opacity: 0,
  transition: 'opacity 150ms',
  backgroundColor: tokens.surface.current.background,
  boxShadow: `${tokens.shadow.sm}, 0 0 0 1px color-mix(in srgb, ${tokens.border.default} 80%, transparent)`,
  selectors: {
    [`${expandableContainer}:hover &`]: { opacity: 1 },
    '&:focus-visible': { opacity: 1 },
  },
});
