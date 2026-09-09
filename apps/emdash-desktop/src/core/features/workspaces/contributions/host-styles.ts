import {
  workspaceRuntimeStatus,
  workspaceScanWarning,
  workspaceScanWarningDetail,
} from '../browser/styles/workspace-status.css';

export const workspacesHostStylesContribution = {
  id: 'workspaces',
  exports: {
    workspaceRuntimeStatus,
    workspaceScanWarning,
    workspaceScanWarningDetail,
  },
} as const;
