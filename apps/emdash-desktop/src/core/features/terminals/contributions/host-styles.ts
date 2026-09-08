import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';
import { xtermThemeIntegrationClass } from '../browser/pty/xterm-theme-adapter.css';

/** Feature-owned Xterm contribution installed on the desktop host root. */
export const terminalsHostStylesContribution = defineDesktopHostStyleContribution({
  id: 'terminals-xterm',
  exports: {
    xtermThemeIntegrationClass,
  },
});
