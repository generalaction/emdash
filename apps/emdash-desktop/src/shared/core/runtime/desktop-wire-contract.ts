import { acpApiContract } from '@emdash/core/runtimes/acp/api/client';
import { agentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import { defineContract } from '@emdash/wire';
import { projectsWireContract } from '@shared/core/projects/wire-contract';
import { workspacesWireContract } from '@shared/core/workspaces/wire-contract';

export const desktopWireContract = defineContract({
  git: gitContract,
  files: filesContract,
  acp: acpApiContract,
  agentConfig: agentConfigContract,
  workspaces: workspacesWireContract,
  projects: projectsWireContract,
});

export type DesktopWireContract = typeof desktopWireContract;
