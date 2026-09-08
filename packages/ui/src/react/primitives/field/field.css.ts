import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { labelBase } from '../label/label.css';

export const field = recipe({
  base: {
    display: 'flex',
    gap: '0.375rem',
    width: '100%',
  },
  variants: {
    orientation: {
      vertical: {
        flexDirection: 'column',
      },
      horizontal: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      },
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

// Label + description stacked, used in horizontal mode to occupy the left side.
export const fieldContent = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: '0.25rem',
  minWidth: 0,
});

// Constrains the control on the right side of a horizontal field row.
// Prevents inputs/selects from filling unlimited width; callers override via className.
// display:flex + justify-content:flex-end right-aligns narrow controls (e.g. Switch).
// marginLeft:auto pushes the slot to the right edge even when FieldContent is absent.
export const fieldControlSlot = style({
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  marginLeft: 'auto',
  flexShrink: 0,
  maxWidth: '12rem',
  width: '100%',
});

// Label typography is owned by the standalone Label primitive; Field.Label
// composes the same base so the two never drift.
export const fieldLabel = style([labelBase]);

export const fieldDescription = style({
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
  lineHeight: 1.5,
});

export const fieldError = style({
  fontSize: tokens.typography.size.sm,
  color: tokens.palette.red.step11,
});

// A semantic grouping of related fields (renders a <fieldset>).
export const fieldSet = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem',
  minWidth: 0,
  margin: 0,
  padding: 0,
  border: 0,
});

export const fieldLegend = recipe({
  base: {
    marginBottom: '0.75rem',
    padding: 0,
    fontWeight: 500,
    color: tokens.foreground.default,
  },
  variants: {
    variant: {
      legend: { fontSize: tokens.typography.size.base },
      label: { fontSize: tokens.typography.size.sm },
    },
  },
  defaultVariants: { variant: 'legend' },
});

// Vertical stack of Field rows with consistent spacing.
export const fieldGroup = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  gap: '1rem',
});
