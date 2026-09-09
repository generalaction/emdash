import { hostAdapter } from '@emdash/ui/styles/host';

/** Rooted adapter for catalog-provided skill SVG and image assets. */
export const skillIconAssetAdapter = hostAdapter({
  root: {
    display: 'inline-flex',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  descendants: {
    '& > svg': {
      display: 'block',
      width: '100%',
      height: '100%',
    },
    '& > img': {
      display: 'block',
      width: '100%',
      height: '100%',
      borderRadius: '0.5rem',
      objectFit: 'contain',
    },
  },
});
