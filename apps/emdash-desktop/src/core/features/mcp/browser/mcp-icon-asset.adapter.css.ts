import { hostAdapter } from '@emdash/ui/styles/host';

/** Rooted adapter for MCP catalog SVG assets imported as markup. */
export const mcpIconAssetAdapter = hostAdapter({
  root: {
    display: 'inline-flex',
    width: '1.25rem',
    height: '1.25rem',
  },
  descendants: {
    '& > svg': {
      display: 'block',
      width: '100%',
      height: '100%',
    },
  },
});
