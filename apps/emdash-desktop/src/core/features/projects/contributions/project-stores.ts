import type { SubjectSpace } from '@core/primitives/mementos/browser';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { ProjectSettingsStore } from '../browser/stores/project-settings-store';
import { ProjectViewStore } from '../browser/stores/project-view';
import { projectViewMemento } from './mementos';

export type ProjectScopedStoreContext = Readonly<{
  data: LocalProject | SshProject;
  space: SubjectSpace<'project'>;
}>;

export const projectViewStoreToken = scopedStoreToken<ProjectViewStore>('projects.view');
export const projectSettingsStoreToken =
  scopedStoreToken<ProjectSettingsStore>('projects.settings');

export const projectScopedStoreContributions: readonly ScopedStoreContribution<ProjectScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: projectViewStoreToken,
      create: ({ space }) => new ProjectViewStore(space.handle(projectViewMemento)),
    }),
    contributeScopedStore({
      token: projectSettingsStoreToken,
      create: ({ data }) =>
        new ProjectSettingsStore(data.id, data.repositoryWorkspaceId ?? undefined),
      dispose: (store) => store.dispose(),
    }),
  ];
