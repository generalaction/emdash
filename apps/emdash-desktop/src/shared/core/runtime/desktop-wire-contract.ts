import { acpApiContract } from '@emdash/core/runtimes/acp/api/client';
import { agentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import { terminalsContract } from '@emdash/core/runtimes/terminals/api';
import { tuiAgentsContract } from '@emdash/core/runtimes/tui-agents/api';
import { defineContract } from '@emdash/wire';
import { notificationsContract } from '@root/src/core/services/notifications/api';
import { pullRequestsContract } from '@root/src/core/services/pull-requests/api';
import { catalogWireContract } from '@shared/core/catalog/wire-contract';
import { projectsWireContract } from '@shared/core/projects/wire-contract';
import { tasksWireContract } from '@shared/core/tasks/wire-contract';
import { terminalTabsWireContract } from '@shared/core/terminals/wire-contract';
import { workspacesWireContract } from '@shared/core/workspaces/wire-contract';

export const desktopWireContract = defineContract({
  git: gitContract,
  files: filesContract,
  acp: acpApiContract,
  agentConfig: agentConfigContract,
  terminals: terminalsContract,
  terminalTabs: terminalTabsWireContract,
  tuiAgents: tuiAgentsContract,
  notifications: notificationsContract,
  pullRequests: pullRequestsContract,
  catalog: catalogWireContract,
  workspaces: workspacesWireContract,
  projects: projectsWireContract,
  tasks: tasksWireContract,
});

export type DesktopWireContract = typeof desktopWireContract;
