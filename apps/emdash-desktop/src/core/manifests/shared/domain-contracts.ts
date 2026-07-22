import { accountContract } from '@core/features/account/api';
import { agentsContract } from '@core/features/agents/api';
import { automationsContract } from '@core/features/automations/api';
import { browserContract } from '@core/features/browser/api';
import { catalogWireContract } from '@core/features/catalog/api';
import { conversationsContract } from '@core/features/conversations/api';
import { editorContract } from '@core/features/editor/api';
import { githubContract } from '@core/features/github/api';
import { integrationsContract } from '@core/features/integrations/api';
import { issuesContract } from '@core/features/issues/api';
import { legacyPortContract } from '@core/features/legacy-port/api';
import { promptLibraryContract } from '@core/features/library/api';
import { machinesContract } from '@core/features/machines/api';
import { mcpContract } from '@core/features/mcp/api';
import { previewServersContract } from '@core/features/preview-servers/api';
import { projectsWireContract } from '@core/features/projects/api';
import { repositoryContract } from '@core/features/repository/api';
import { searchContract } from '@core/features/search/api';
import { skillsContract } from '@core/features/skills/api';
import { sourceControlContract } from '@core/features/source-control/api';
import { tasksWireContract } from '@core/features/tasks/api';
import { telemetryContract } from '@core/features/telemetry/api';
import { terminalsContract } from '@core/features/terminals/api';
import { updatesContract } from '@core/features/updates/api';
import { desktopHostContract } from '@core/features/workbench/api';
import {
  projectSettingsContract,
  projectWorkspacesContract,
  workspacesWireContract,
} from '@core/features/workspaces/api';
import { mementosWireContract } from '@core/primitives/mementos/api';
import { remoteMachineContract } from '@core/services/remote-machine/api';
import { appSettingsContract } from '@core/services/settings/api';
import { sshContract } from '@core/services/ssh/api';
import { notificationsContract } from '@root/src/core/services/notifications/api';
import { pullRequestsContract } from '@root/src/core/services/pull-requests/api';

export const desktopDomainContracts = {
  account: accountContract,
  agents: agentsContract,
  appSettings: appSettingsContract,
  editor: editorContract,
  legacyPort: legacyPortContract,
  machines: machinesContract,
  projectSettings: projectSettingsContract,
  projectWorkspaces: projectWorkspacesContract,
  promptLibrary: promptLibraryContract,
  repository: repositoryContract,
  search: searchContract,
  telemetry: telemetryContract,
  sourceControl: sourceControlContract,
  mcp: mcpContract,
  skills: skillsContract,
  terminals: terminalsContract,
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
  remoteMachine: remoteMachineContract,
  tasks: tasksWireContract,
  updates: updatesContract,
  host: desktopHostContract,
} as const;
