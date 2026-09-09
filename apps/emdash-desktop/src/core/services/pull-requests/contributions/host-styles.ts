import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';
import { pullRequestState } from '../browser/styles/pull-request-state.css';

export const pullRequestsHostStylesContribution = defineDesktopHostStyleContribution({
  id: 'pull-requests',
  exports: {
    pullRequestState,
  },
});
