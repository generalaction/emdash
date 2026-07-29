import type { ProvisionWorkspaceInput } from '@runtimes/workspace/api/schemas';
import type { WorkspaceProvisioningInput } from '@services/workspace-provisioning/api';
import type { BootstrapGitIntent } from './intent';
import { nativePathFromWorkspace, workspaceFromNativePath } from './paths';
import { compileBootstrapPlan } from './planner';

export type CompiledProvisioningIntent = {
  provisionInput: ProvisionWorkspaceInput;
  branchName: string | null;
};

export function compileProvisioningIntent(
  input: WorkspaceProvisioningInput,
  generatedName = input.generatedName
): CompiledProvisioningIntent {
  if (input.workspace.kind === 'directory') {
    return {
      provisionInput: { workspace: input.workspace.path },
      branchName: null,
    };
  }

  const repositoryPath = nativePathFromWorkspace(input.workspace.repository);
  const worktreePoolPath = nativePathFromWorkspace({
    host: input.workspace.repository.host,
    path: input.workspace.worktreePoolPath,
  });
  const intent = toBootstrapGitIntent(input.workspace, generatedName);
  const compiled = compileBootstrapPlan(intent, {
    worktreePoolPath,
    baseRemote: input.workspace.baseRemote,
  });
  const branchName =
    input.workspace.git.kind === 'create-branch' ? generatedName : input.workspace.git.branchName;
  const workspace = workspaceFromNativePath(
    compiled.workspacePath,
    input.workspace.repository.host
  );

  return {
    branchName,
    provisionInput: {
      workspace,
      lifecycle: {
        ref: {
          kind: 'worktree',
          repoPath: repositoryPath,
          path: compiled.workspacePath,
          branchName,
        },
        context: {
          repoPath: repositoryPath,
          preservePatterns: input.workspace.preservePatterns,
          worktreePoolPath,
        },
        setupPlan: compiled.plan,
      },
    },
  };
}

function toBootstrapGitIntent(
  workspace: Extract<WorkspaceProvisioningInput['workspace'], { kind: 'worktree' }>,
  generatedName: string
): BootstrapGitIntent {
  const { git } = workspace;
  if (git.kind === 'use-branch') {
    return { kind: 'use-branch', branchName: git.branchName };
  }
  return {
    kind: 'create-branch',
    branchName: generatedName,
    fromBranch: git.fromBranch,
    ...(git.pushRemote ? { pushRemote: git.pushRemote } : {}),
  };
}
