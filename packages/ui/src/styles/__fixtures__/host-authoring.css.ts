import { tokens } from '@emdash/theme';
import { hostAdapter, hostRecipe, hostStyle } from '../host';
import { editorIntegration } from './integration-manifest';

export const hostStyleFixture = hostStyle({
  vars: editorIntegration.declarations,
  color: tokens.foreground.default,
});

export const hostAdapterFixture = hostAdapter({
  root: {
    display: 'block',
  },
  descendants: {
    '& .foreign-editor': {
      background: tokens.surface.current.background,
    },
  },
});

export const hostRecipeFixture = hostRecipe({
  variants: {
    status: {
      idle: {
        opacity: 0.5,
      },
      active: {
        opacity: 1,
      },
    },
  },
});

if (false) {
  // @ts-expect-error Host authors cannot select or override a cascade layer.
  hostStyle({
    '@layer': {
      foreign: {
        color: 'red',
      },
    },
  });
}
