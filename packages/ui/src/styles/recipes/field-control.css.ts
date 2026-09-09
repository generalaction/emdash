import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';
import { fieldControlVars } from './field-control-contract';
import { iconSizeVar } from './icon-contract';

/**
 * Private anatomy for the public `fieldControl()` Recipe.
 *
 * The visual/state shell is composed by the public function so grouped and
 * multiline fields can reuse it without exposing those internal modes.
 */
export const fieldControlAnatomy = recipe({
  base: {
    width: '100%',
    minWidth: 0,
    fontSize: tokens.typography.size.sm,
    colorScheme: 'light',
    vars: {
      [iconSizeVar]: '1rem',
    },
    selectors: {
      '&::placeholder': { color: tokens.foreground.passive },
      '&[data-placeholder]': { color: tokens.foreground.passive },
      '&[type="search"]::-webkit-search-cancel-button': { display: 'none' },
    },
  },
  variants: {
    size: {
      base: {
        height: '2rem',
        paddingTop: '0.25rem',
        paddingRight: `var(${fieldControlVars.paddingRight}, 0.625rem)`,
        paddingBottom: '0.25rem',
        paddingLeft: `var(${fieldControlVars.paddingLeft}, 0.625rem)`,
      },
      sm: {
        height: '1.5rem',
        paddingTop: '0.125rem',
        paddingRight: `var(${fieldControlVars.paddingRight}, 0.5rem)`,
        paddingBottom: '0.125rem',
        paddingLeft: `var(${fieldControlVars.paddingLeft}, 0.5rem)`,
        fontSize: tokens.typography.size.xs,
      },
    },
  },
  defaultVariants: {
    size: 'base',
  },
});
