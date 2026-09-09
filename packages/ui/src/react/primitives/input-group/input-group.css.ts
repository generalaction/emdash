import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';

const inputGroupBase = style({
  position: 'relative',
  display: 'flex',
  width: '100%',
  minWidth: 0,
  alignItems: 'center',
  borderRadius: tokens.radius.md,
  outline: 'none',
  selectors: {
    '&:has(>[data-align="block-end"])': {
      height: 'auto',
      flexDirection: 'column',
    },
    '&:has(>[data-align="block-start"])': {
      height: 'auto',
      flexDirection: 'column',
    },
    '&:has(>textarea)': { height: 'auto' },
  },
});

export const inputGroup = recipe({
  base: inputGroupBase,
  variants: {
    size: {
      base: {
        height: '2rem',
        fontSize: tokens.typography.size.sm,
      },
      sm: {
        height: '1.5rem',
        fontSize: tokens.typography.size.xs,
      },
    },
    appearance: {
      standalone: {},
      embedded: {
        width: 'auto',
      },
    },
  },
  defaultVariants: {
    size: 'base',
    appearance: 'standalone',
  },
});

const inputGroupAddonBase = style({
  display: 'flex',
  height: 'auto',
  cursor: 'text',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'inherit',
  fontWeight: 400,
  color: tokens.foreground.muted,
  userSelect: 'none',
  selectors: {
    [`${inputGroupBase}[data-disabled] &`]: { opacity: 0.5 },
  },
});

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
  borderRadius: `calc(${tokens.radius.md} - 5px)`,
  boxShadow: 'none',
});

export const inputGroupText = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: 'inherit',
  color: tokens.foreground.muted,
});

export const inputGroupControl = style({
  flex: 1,
  width: '100%',
  minWidth: 0,
  height: '2rem',
  borderRadius: 0,
  border: 0,
  backgroundColor: 'transparent',
  color: 'inherit',
  colorScheme: 'light',
  paddingTop: '0.25rem',
  paddingRight: '0.625rem',
  paddingBottom: '0.25rem',
  paddingLeft: '0.625rem',
  font: 'inherit',
  outline: 'none',
  boxShadow: 'none',
  selectors: {
    '&::placeholder': { color: tokens.foreground.passive },
    [`${inputGroupBase}[data-size='sm'] &`]: {
      height: '1.5rem',
      paddingTop: '0.125rem',
      paddingRight: '0.5rem',
      paddingBottom: '0.125rem',
      paddingLeft: '0.5rem',
    },
    [`${inputGroupBase}:has(>[data-align='block-end']) &`]: {
      paddingTop: '0.75rem',
    },
    [`${inputGroupBase}:has(>[data-align='block-start']) &`]: {
      paddingBottom: '0.75rem',
    },
    [`${inputGroupBase}:has(>[data-align='inline-end']) &`]: {
      paddingRight: '0.375rem',
    },
    [`${inputGroupBase}:has(>[data-align='inline-start']) &`]: {
      paddingLeft: '0.375rem',
    },
  },
});

export const inputGroupTextareaControl = style([
  inputGroupControl,
  {
    height: 'auto',
    minHeight: '4rem',
    fieldSizing: 'content',
    paddingTop: '0.5rem',
    paddingBottom: '0.5rem',
    resize: 'none',
  },
]);
