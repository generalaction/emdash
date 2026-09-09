import { hostAdapter } from '@emdash/ui/styles/host';

/** Rooted adapter for legacy integration logo markup and image URLs. */
export const integrationLogoAdapter = hostAdapter({
  root: {
    display: 'inline-flex',
    width: '1.25rem',
    height: '1.25rem',
    alignItems: 'center',
    justifyContent: 'center',
  },
  descendants: {
    '& > svg': {
      display: 'block',
      width: '100%',
      height: '100%',
      flexShrink: 0,
    },
    '& > img': {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
    },
  },
});
