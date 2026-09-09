import { style, type StyleRule } from '@emdash/ui/styles';

const valid: StyleRule = {
  color: 'var(--em-foreground)',
  display: 'grid',
  vars: {
    '--_example-columns': '2',
  },
  selectors: {
    '&:hover': {
      color: 'var(--em-foreground-muted)',
    },
  },
  '@media': {
    '(min-width: 40rem)': {
      gridTemplateColumns: 'repeat(var(--_example-columns), minmax(0, 1fr))',
    },
  },
};

style(valid);

// @ts-expect-error StyleRule rejects misspelled CSS properties.
const misspelledProperty: StyleRule = { bakgroundColor: 'red' };
// @ts-expect-error Cascade layers are infrastructure-owned.
const callerSelectedLayer: StyleRule = { '@layer': { 'emdash.host': { color: 'red' } } };

void [misspelledProperty, callerSelectedLayer];
