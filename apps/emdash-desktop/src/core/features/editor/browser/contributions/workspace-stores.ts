import { modelRegistry } from '@core/features/editor/api/browser/monaco/monaco-model-registry';
import type { WorkspaceScopedStoreContext } from '@core/features/workspaces/contributions/browser/workspace-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

type WorkspaceModelBinding = Readonly<{
  projectId: string;
  workspaceId: string;
}>;

export const workspaceModelBindingToken =
  scopedStoreToken<WorkspaceModelBinding>('editor.model-binding');

export const editorWorkspaceStoreContributions: readonly ScopedStoreContribution<WorkspaceScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: workspaceModelBindingToken,
      create: ({ projectId, workspaceId, path, sshConnectionId }) => {
        modelRegistry.bindWorkspaceRoot(projectId, workspaceId, path, sshConnectionId);
        return { projectId, workspaceId };
      },
      dispose: ({ projectId, workspaceId }) => {
        modelRegistry.unbindWorkspaceRoot(projectId, workspaceId);
      },
    }),
  ];
