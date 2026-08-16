import { compileWorktreePayload } from '@emdash/core/runtimes/workspace-registry/api';
import { FolderGit2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  resolveRendererEffectiveSettings,
  useEffectiveSettingsInputs,
  type EffectiveSettingsInputs,
} from '@core/features/projects/api/browser/effective-settings/use-effective-settings';
import {
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { compileWorktreeGitPlan, type WorkspaceConfig } from '@core/primitives/workspaces/api';

/**
 * The resolved worktree destination shown before creation (spec:
 * github-git-settings §6): the same blessed resolver (`worktreeRoot` over the
 * settings page inputs) and the same derivation (`compileWorktreePayload`)
 * execution runs in `createTask`, so preview and the created worktree cannot
 * diverge. An invalid configured root surfaces the degrade warning here too.
 */
export const WorktreeDestinationPreview = observer(function WorktreeDestinationPreview({
  projectId,
  workspaceConfig,
}: {
  projectId: string;
  workspaceConfig: WorkspaceConfig;
}) {
  const inputs = useEffectiveSettingsInputs(projectId);
  const projectPath = projectData(getProjectStore(projectId))?.path;

  if (!inputs || projectPath === undefined) return null;
  return (
    <WorktreeDestinationPreviewView
      inputs={inputs}
      projectPath={projectPath}
      workspaceConfig={workspaceConfig}
    />
  );
});

/** The store-free rendering over resolver inputs; exported for browser tests. */
export function WorktreeDestinationPreviewView({
  inputs,
  projectPath,
  workspaceConfig,
}: {
  inputs: EffectiveSettingsInputs;
  projectPath: string;
  workspaceConfig: WorkspaceConfig;
}) {
  if (workspaceConfig.workspace.kind !== 'new-worktree') return null;
  const git = workspaceConfig.git;
  if (git.kind === 'none') return null;

  const effective = resolveRendererEffectiveSettings(inputs);

  let branchName: string;
  try {
    // The identical plan compilation createTask runs, over the identical
    // resolver-backed base and push remotes.
    branchName = compileWorktreeGitPlan(git, {
      baseRemote: effective.baseRemote.value,
      pushRemote: effective.pushRemote.value,
    }).branch;
  } catch {
    return null;
  }
  if (branchName.trim() === '') return null;

  const worktreeRoot = effective.worktreeRoot;
  const { worktreePath } = compileWorktreePayload({
    repoPath: projectPath,
    worktreeRoot: worktreeRoot.value,
    branchName,
  });

  return (
    <div className="flex flex-col gap-1 text-xs text-foreground-muted">
      <span className="flex min-w-0 items-center gap-1.5">
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="shrink-0">Worktree:</span>
        <code className="min-w-0 truncate font-mono" title={worktreePath}>
          {worktreePath}
        </code>
      </span>
      {worktreeRoot.provenance.kind === 'broken-setting' ? (
        <span className="text-foreground-warning">
          The configured worktree root '{worktreeRoot.provenance.staleValue}' is not usable —
          falling back to <code className="font-mono">{worktreeRoot.value}</code>.
        </span>
      ) : null}
    </div>
  );
}
