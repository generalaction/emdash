import { hostAdapter } from '@emdash/ui/styles/host';

/**
 * Rooted adapter for plugin-owned SVG markup and image assets.
 *
 * `--_plugin-icon-size` is a private runtime geometry contract. It is not a
 * theme Token because plugin artwork size belongs to the call site.
 */
export const pluginAssetAdapter = hostAdapter({
  root: {
    display: 'inline-flex',
    width: 'var(--_plugin-icon-size, 1rem)',
    height: 'var(--_plugin-icon-size, 1rem)',
    flexShrink: 0,
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
