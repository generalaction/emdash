import { ProjectViewWrapper } from '@core/features/projects/api/browser/components/project-view-wrapper';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import { appState } from '@renderer/lib/stores/app-state';
import { ProjectMainPanel } from './components/main-panel/main-panel';
import { ProjectTitlebar } from './components/project-titlebar';

export const projectViewRuntime = defineViewRuntime(projectViewDef, {
  slots: {
    wrap: ProjectViewWrapper,
    titlebar: ProjectTitlebar,
    main: ProjectMainPanel,
  },
  resolve: ({ projectId }) => {
    return appState.projects.projects.has(projectId) ||
      appState.projects.pendingCreationIds.has(projectId)
      ? { kind: 'ok' }
      : { kind: 'redirect', ref: homeViewDef() };
  },
});
