import { projectStoreContributions } from './project-scoped-stores';
import { workspaceStoreContributions } from './workspace-scoped-stores';

export const scopedStoreContributions = {
  project: projectStoreContributions,
  workspace: workspaceStoreContributions,
} as const;
