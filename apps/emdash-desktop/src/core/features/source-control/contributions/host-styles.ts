import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';
import { diffLine } from '../browser/styles/diff-line.css';
import { vcsState } from '../browser/styles/vcs-state.css';

/** Feature-owned product Recipes aggregated by the desktop Host Styling Adapter. */
export const sourceControlHostStylesContribution = defineDesktopHostStyleContribution({
  id: 'source-control',
  exports: {
    diffLine,
    vcsState,
  },
});
