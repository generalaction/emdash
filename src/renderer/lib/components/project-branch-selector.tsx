import { observer } from 'mobx-react-lite';
import React from 'react';
import type { Branch } from '@shared/git';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { BranchSelector, type BranchLabelRemoteMode } from './branch-selector';

export interface ProjectBranchSelectorProps {
  projectId: string;
  value?: Branch;
  onValueChange: (value: Branch) => void;
  remoteOnly?: boolean;
  remoteName?: string;
  branchLabelRemote?: BranchLabelRemoteMode;
  trigger?: React.ReactNode;
}

export const ProjectBranchSelector = observer(function ProjectBranchSelector({
  projectId,
  value,
  onValueChange,
  remoteOnly,
  remoteName,
  branchLabelRemote,
  trigger,
}: ProjectBranchSelectorProps) {
  const repo = getRepositoryStore(projectId);
  const selectedRemoteName = remoteName ?? repo?.baseRemote.name ?? 'origin';

  const branches: Branch[] = repo
    ? repo.branches.filter(
        (b) => b.type === 'local' || (b.type === 'remote' && b.remote.name === selectedRemoteName)
      )
    : [];

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
    />
  );
});
