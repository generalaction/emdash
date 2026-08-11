import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import {
  BranchSelector,
  type BranchLabelRemoteMode,
} from '@core/features/source-control/browser/components/branch-selector';

export interface ProjectBranchSelectorProps {
  projectId: string;
  value?: GitBranchRef;
  onValueChange: (value: GitBranchRef) => void;
  remoteOnly?: boolean;
  remoteName?: string;
  branchLabelRemote?: BranchLabelRemoteMode;
  trigger?: React.ReactNode;
  showRemoteSelectorFooter?: boolean;
}

export const ProjectBranchSelector = observer(function ProjectBranchSelector({
  projectId,
  value,
  onValueChange,
  remoteOnly,
  remoteName,
  branchLabelRemote,
  trigger,
  showRemoteSelectorFooter = false,
}: ProjectBranchSelectorProps) {
  const repo = getGitRepositoryStore(projectId);
  // The effective base remote from the resolver; undefined at zero remotes,
  // which simply hides the remote-selector footer (no remote branches exist).
  const selectedRemoteName =
    remoteName ??
    (value?.type === 'remote' ? value.remote.name : undefined) ??
    repo?.baseRemote?.name ??
    undefined;

  const branches: GitBranchRef[] = repo ? [...repo.localBranches, ...repo.remoteBranches] : [];
  const canSelectRemote = showRemoteSelectorFooter && remoteName === undefined;

  return (
    <BranchSelector
      branches={branches}
      value={value}
      onValueChange={onValueChange}
      remoteOnly={remoteOnly}
      branchLabelRemote={branchLabelRemote}
      trigger={trigger}
      onRefresh={() => repo?.refresh()}
      isRefreshing={repo?.loading ?? false}
      remotes={canSelectRemote ? repo?.remotes : undefined}
      selectedRemoteName={
        showRemoteSelectorFooter || remoteName !== undefined ? selectedRemoteName : undefined
      }
    />
  );
});
