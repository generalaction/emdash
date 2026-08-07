import { ProjectViewWrapper } from '@core/features/projects/api/browser/components/project-view-wrapper';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import { ProjectMainPanel } from './components/main-panel/main-panel';
import { ProjectTitlebar } from './components/project-titlebar';

export const projectViewRuntime = defineViewRuntime(projectViewDef, {
  slots: {
    wrap: ProjectViewWrapper,
    titlebar: ProjectTitlebar,
    main: ProjectMainPanel,
  },
  resolve: ({ projectId }) => {
    return getProjectManagerStore().projects.has(projectId) ||
      getProjectManagerStore().pendingCreationIds.has(projectId)
      ? { kind: 'ok' }
      : { kind: 'redirect', ref: homeViewDef() };
  },
});
