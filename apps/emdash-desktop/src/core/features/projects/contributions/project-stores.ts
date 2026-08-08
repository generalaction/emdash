import { EMDASH_CONFIG_FILE } from '@emdash/core/primitives/emdash-config/api';
import { ProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-settings-store';
import {
  workspaceChromeStore,
  type WorkspaceChromeStore,
} from '@core/features/projects/api/browser/stores/workspace-chrome-store';
import { resolveWorkspacePath } from '@core/features/workspaces/api/browser/workspace-path';
import { createChromeStore } from '@core/primitives/chrome-stores/browser';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { SubjectSpace } from '@core/primitives/mementos/browser';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { ProjectViewStore } from '../browser/stores/project-view';
import { projectViewMemento } from './mementos';

export type ProjectScopedStoreContext = Readonly<{
  data: LocalProject | SshProject;
  space: SubjectSpace<'project'>;
}>;

export const projectViewStoreToken = scopedStoreToken<ProjectViewStore>('projects.view');
export const projectSettingsStoreToken =
  scopedStoreToken<ProjectSettingsStore>('projects.settings');
export const workspaceChromeStoreToken = scopedStoreToken<WorkspaceChromeStore>(
  'projects.workspace-chrome'
);

export const projectScopedStoreContributions: readonly ScopedStoreContribution<ProjectScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: projectViewStoreToken,
      create: ({ space }) => new ProjectViewStore(space.handle(projectViewMemento)),
    }),
    contributeScopedStore({
      token: projectSettingsStoreToken,
      // Workspace→root resolution happens here at the renderer edge (spec §2/§8):
      // the config watch is keyed by the repository root's file identity.
      create: ({ data }) =>
        new ProjectSettingsStore(
          data.id,
          data.repositoryWorkspaceId
            ? hostFileRefFromNativePath(
                resolveWorkspacePath(data.path, EMDASH_CONFIG_FILE),
                data.type === 'ssh' ? data.connectionId : undefined
              )
            : undefined
        ),
      dispose: (store) => store.dispose(),
    }),
    contributeScopedStore({
      token: workspaceChromeStoreToken,
      create: ({ space }) => createChromeStore(workspaceChromeStore, space),
    }),
  ];
