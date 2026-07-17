import { acpApiContract } from '@emdash/core/runtimes/acp/api/client';
import { agentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import { terminalsContract } from '@emdash/core/runtimes/terminals/api';
import { tuiAgentsContract } from '@emdash/core/runtimes/tui-agents/api';
import { defineContract } from '@emdash/wire';
import { automationsContract } from '@core/features/automations/api';
import { browserContract } from '@core/features/browser/api';
import { conversationsContract } from '@core/features/conversations/api';
import { githubContract } from '@core/features/github/api';
import { integrationsContract } from '@core/features/integrations/api';
import { issuesContract } from '@core/features/issues/api';
import { previewServersContract } from '@core/features/preview-servers/api';
import { projectsWireContract } from '@core/features/projects/api';
import { sshContract } from '@core/features/ssh/api';
import { tasksWireContract } from '@core/features/tasks/api';
import { terminalTabsWireContract } from '@core/features/terminals/api';
import { updatesContract } from '@core/features/updates/api';
import { desktopHostContract } from '@core/features/workbench/api';
import { workspacesWireContract } from '@core/features/workspaces/api';
import { mementosWireContract } from '@core/primitives/mementos/api';
import { catalogWireContract } from '@core/services/catalog/api';
import { notificationsContract } from '@root/src/core/services/notifications/api';
import { pullRequestsContract } from '@root/src/core/services/pull-requests/api';
import {
  accountContract,
  agentsContract,
  appSettingsContract,
  editorContract,
  legacyPortContract,
  projectSettingsContract,
  projectWorkspacesContract,
  promptLibraryContract,
  repositoryContract,
  searchContract,
  telemetryContract,
} from './legacy-rpc-wire-contracts';

export const desktopWireContract = defineContract({
  account: accountContract,
  agents: agentsContract,
  appSettings: appSettingsContract,
  editor: editorContract,
  legacyPort: legacyPortContract,
  projectSettings: projectSettingsContract,
  projectWorkspaces: projectWorkspacesContract,
  promptLibrary: promptLibraryContract,
  repository: repositoryContract,
  search: searchContract,
  telemetry: telemetryContract,
  git: gitContract,
  files: filesContract,
  acp: acpApiContract,
  agentConfig: agentConfigContract,
  terminals: terminalsContract,
  terminalTabs: terminalTabsWireContract,
  tuiAgents: tuiAgentsContract,
  mementos: mementosWireContract,
  notifications: notificationsContract,
  pullRequests: pullRequestsContract,
  catalog: catalogWireContract,
  workspaces: workspacesWireContract,
  projects: projectsWireContract,
  automations: automationsContract,
  browser: browserContract,
  conversations: conversationsContract,
  previewServers: previewServersContract,
  github: githubContract,
  integrations: integrationsContract,
  issues: issuesContract,
  ssh: sshContract,
  tasks: tasksWireContract,
  updates: updatesContract,
  host: desktopHostContract,
});

export type DesktopWireContract = typeof desktopWireContract;
