import { globalLayer } from '@vanilla-extract/css';

export const layerNames = {
  vendor: 'emdash.vendor',
  reset: 'emdash.reset',
  tokens: 'emdash.tokens',
  base: 'emdash.base',
  recipes: 'emdash.recipes',
  utilities: 'emdash.utilities',
  host: 'emdash.host',
} as const;

globalLayer(Object.values(layerNames).join(', '));
