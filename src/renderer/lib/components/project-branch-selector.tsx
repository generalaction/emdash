import { observer } from 'mobx-react-lite';
import React from 'react';
import type { Branch } from '@shared/git';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { BranchSelector } from './branch-selector';

export interface ProjectBranchSelectorProps {
  projectId: string;
  value?: Branch;
  onValueChange: (value: Branch) => void;
  remoteOnly?: boolean;
  trigger?: React.ReactNode;
}

export const ProjectBranchSelector = observer(function ProjectBranchSelector({
  projectId,
  value,
  onValueChange,
  remoteOnly,
  trigger,
}: ProjectBranchSelectorProps) {
  const repo = getRepositoryStore(projectId);
  return (
    <BranchSelector
      branches={repo?.branches ?? []}
      value={value}
      onValueChange={onValueChange}
      remoteOnly={remoteOnly}
      trigger={trigger}
      onRefresh={() => repo?.refresh()}
      isRefreshing={repo?.loading ?? false}
    />
  );
});
