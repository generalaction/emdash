import type { WorkspaceScopedStoreContext } from '@core/features/workspaces/browser/contributions/workspace-stores';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { modelRegistry } from '../monaco/monaco-model-registry';
import { releaseFileModelManager } from '../task-editor/stores/file-model-manager';

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
      create: ({ projectId, workspaceId, path }) => {
        modelRegistry.bindWorkspaceRoot(projectId, workspaceId, path);
        return { projectId, workspaceId };
      },
      dispose: ({ projectId, workspaceId }) => {
        releaseFileModelManager(workspaceId);
        modelRegistry.unbindWorkspaceRoot(projectId, workspaceId);
      },
    }),
  ];
