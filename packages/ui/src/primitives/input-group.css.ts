import { recipe } from '@vanilla-extract/recipes';
import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';

export const inputGroup = style({
  position: 'relative',
  display: 'flex',
  height: '2.25rem',
  width: '100%',
  minWidth: 0,
  alignItems: 'center',
  borderRadius: 'var(--radius-md)',
  border: `1px solid ${vars.border}`,
  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
  transition: 'color 150ms, box-shadow 150ms',
  outline: 'none',
  selectors: {
    // focus ring on control focus
    '&:has([data-slot="input-group-control"]:focus-visible)': {
      borderColor: vars.borderPrimary,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderPrimary} 30%, transparent)`,
    },
    // invalid ring
    '&:has([data-slot][aria-invalid="true"])': {
      borderColor: vars.borderDestructive,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderDestructive} 20%, transparent)`,
    },
    // block-end addon -> column layout
    '&:has(>[data-align="block-end"])': { height: 'auto', flexDirection: 'column' },
    '&:has(>[data-align="block-start"])': { height: 'auto', flexDirection: 'column' },
    // textarea child -> auto height
    '&:has(>textarea)': { height: 'auto' },
    // inside combobox content: no focus ring
    '[data-slot="combobox-content"] &:focus-within': { borderColor: 'inherit', boxShadow: 'none' },
    // disabled state
    '&[data-disabled="true"]': { opacity: 0.5 },
  },
});
// input padding adjustments when block addons are present (targeting child inputs)
globalStyle(`${inputGroup}:has(>[data-align="block-end"]) > input`, { paddingTop: '0.75rem' });
globalStyle(`${inputGroup}:has(>[data-align="block-start"]) > input`, { paddingBottom: '0.75rem' });
// inline addon input padding
globalStyle(`${inputGroup}:has(>[data-align="inline-end"]) > input`, { paddingRight: '0.375rem' });
globalStyle(`${inputGroup}:has(>[data-align="inline-start"]) > input`, { paddingLeft: '0.375rem' });

const inputGroupAddonBase = style({
  display: 'flex',
  height: 'auto',
  cursor: 'text',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: vars.foregroundMuted,
  userSelect: 'none',
  selectors: {
    '[data-slot="input-group"][data-disabled="true"] &': { opacity: 0.5 },
  },
});
globalStyle(`${inputGroupAddonBase} > kbd`, { borderRadius: 'calc(var(--radius-md) - 5px)' });
globalStyle(`${inputGroupAddonBase} > svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const inputGroupAddon = recipe({
  base: inputGroupAddonBase,
  variants: {
    align: {
      'inline-start': {
        order: -1,
        paddingLeft: '0.5rem',
        selectors: {
          '&:has(>button)': { marginLeft: '-0.25rem' },
          '&:has(>kbd)': { marginLeft: '-0.15rem' },
        },
      },
      'inline-end': {
        order: 1,
        paddingRight: '0.5rem',
        selectors: {
          '&:has(>button)': { marginRight: '-0.25rem' },
          '&:has(>kbd)': { marginRight: '-0.15rem' },
        },
      },
      'block-start': {
        order: -1,
        width: '100%',
        justifyContent: 'flex-start',
        paddingLeft: '0.625rem',
        paddingRight: '0.625rem',
        paddingTop: '0.5rem',
      },
      'block-end': {
        order: 1,
        width: '100%',
        justifyContent: 'flex-start',
        paddingLeft: '0.625rem',
        paddingRight: '0.625rem',
        paddingBottom: '0.5rem',
      },
    },
  },
  defaultVariants: {
    align: 'inline-start',
  },
});

export const inputGroupButton = style({
  borderRadius: 'calc(var(--radius-md) - 5px)',
  boxShadow: 'none',
});

export const inputGroupText = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: 'var(--text-sm)',
  color: vars.foregroundMuted,
});
globalStyle(`${inputGroupText} svg`, { pointerEvents: 'none' });
globalStyle(`${inputGroupText} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const inputGroupControl = style({
  flex: 1,
  borderRadius: 0,
  border: 0,
  backgroundColor: 'transparent',
  boxShadow: 'none',
  selectors: {
    '&:focus-visible': { boxShadow: 'none !important', border: '0 !important' },
    '&[aria-invalid="true"]': { boxShadow: 'none !important' },
  },
});

export const inputGroupTextareaControl = style({
  flex: 1,
  resize: 'none',
  borderRadius: 0,
  border: 0,
  backgroundColor: 'transparent',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  boxShadow: 'none',
  selectors: {
    '&:focus-visible': { boxShadow: 'none' },
    '&[aria-invalid="true"]': { boxShadow: 'none' },
  },
});
