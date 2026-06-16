import { observer } from 'mobx-react-lite';
import React from 'react';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import type { Branch } from '@shared/core/git/git';
import { BranchSelector, type BranchLabelRemoteMode } from './branch-selector';

export interface ProjectBranchSelectorProps {
  projectId: string;
  value?: Branch;
  onValueChange: (value: Branch) => void;
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
  const repo = getRepositoryStore(projectId);
  const selectedRemoteName =
    remoteName ??
    (value?.type === 'remote' ? value.remote.name : undefined) ??
    repo?.baseRemote.name ??
    'origin';

  const branches: Branch[] = repo ? [...repo.localBranches, ...repo.remoteBranches] : [];
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
