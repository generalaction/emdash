import { sourceControlHostStylesContribution } from '@core/features/source-control/contributions/host-styles';
import { tasksHostStylesContribution } from '@core/features/tasks/contributions/host-styles';
import {
  DESKTOP_HOST_ROOT_ATTRIBUTE,
  desktopHostRootMarker,
} from '@core/primitives/styling/api/desktop-host-styles';

const { diffLine, vcsState } = sourceControlHostStylesContribution.exports;
const { workflowStatus } = tasksHostStylesContribution.exports;

export const lightProductRecipeFixture = {
  scheme: 'emlight',
  rootAttribute: DESKTOP_HOST_ROOT_ATTRIBUTE,
  rootMarker: desktopHostRootMarker,
  samples: {
    diffAdded: diffLine({ kind: 'added' }),
    vcsMerged: vcsState({ state: 'merged' }),
    workflowInProgress: workflowStatus({ status: 'in-progress' }),
  },
} as const;

export const darkProductRecipeFixture = {
  scheme: 'emdark',
  rootAttribute: DESKTOP_HOST_ROOT_ATTRIBUTE,
  rootMarker: desktopHostRootMarker,
  samples: {
    diffDeleted: diffLine({ kind: 'deleted' }),
    vcsConflicted: vcsState({ state: 'conflicted' }),
    workflowInReview: workflowStatus({ status: 'in-review' }),
  },
} as const;
