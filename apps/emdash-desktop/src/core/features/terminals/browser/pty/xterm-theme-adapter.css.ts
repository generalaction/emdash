import { hostAdapter } from '@emdash/ui/styles/host';
import { xtermThemeIntegration } from './xterm-theme-integration';

/** Desktop-root integration writer and rooted adapter for Xterm-owned viewport DOM. */
export const xtermThemeIntegrationClass = hostAdapter({
  root: xtermThemeIntegration.writer,
  descendants: {
    '& .xterm .xterm-viewport': {
      backgroundColor: 'transparent',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
    },
    '& .xterm .xterm-viewport::-webkit-scrollbar': {
      width: 0,
      height: 0,
    },
  },
});
