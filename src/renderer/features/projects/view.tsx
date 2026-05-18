import type { GuardResult } from '@renderer/app/view-registry';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import { appState } from '@renderer/lib/stores/app-state';
import { ProjectMainPanel } from './components/main-panel/main-panel';
import { ProjectTitlebar } from './components/project-titlebar';

export const projectView = {
  WrapView: ProjectViewWrapper,
  TitlebarSlot: ProjectTitlebar,
  MainPanel: ProjectMainPanel,
  canActivate: ({ projectId }: { projectId: string }): GuardResult =>
    appState.projects.projects.has(projectId) || appState.projects.pendingCreationIds.has(projectId)
      ? { ok: true }
      : { ok: false, redirect: 'home' },
};
