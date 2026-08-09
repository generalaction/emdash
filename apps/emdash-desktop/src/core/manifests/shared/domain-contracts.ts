import { accountContract, accountDomain } from '@core/features/account/api';
import { agentsContract, agentsDomain } from '@core/features/agents/api';
import { automationsContract, automationsDomain } from '@core/features/automations/api';
import { browserContract, browserDomain } from '@core/features/browser/api';
import { catalogDomain, catalogWireContract } from '@core/features/catalog/api';
import { conversationsContract, conversationsDomain } from '@core/features/conversations/api';
import { devPerfContract, devPerfDomain } from '@core/features/dev-perf/api';
import { editorContract, editorDomain } from '@core/features/editor/api';
import { filesDomain, filesWireContract } from '@core/features/files/api';
import { githubContract, githubDomain } from '@core/features/github/api';
import { integrationsContract, integrationsDomain } from '@core/features/integrations/api';
import { issuesContract, issuesDomain } from '@core/features/issues/api';
import { legacyPortContract, legacyPortDomain } from '@core/features/legacy-port/api';
import { promptLibraryContract, promptLibraryDomain } from '@core/features/library/api';
import { machinesContract, machinesDomain } from '@core/features/machines/api';
import { mcpContract, mcpDomain } from '@core/features/mcp/api';
import { previewServersContract, previewServersDomain } from '@core/features/preview-servers/api';
import { projectsDomain, projectsWireContract } from '@core/features/projects/api';
import { repositoryContract, repositoryDomain } from '@core/features/repository/api';
import { searchContract, searchDomain } from '@core/features/search/api';
import { skillsContract, skillsDomain } from '@core/features/skills/api';
import { sourceControlContract, sourceControlDomain } from '@core/features/source-control/api';
import { tasksDomain, tasksWireContract } from '@core/features/tasks/api';
import { terminalsContract, terminalsDomain } from '@core/features/terminals/api';
import { updatesContract, updatesDomain } from '@core/features/updates/api';
import {
  lifecycleScriptsDomain,
  lifecycleScriptsWireContract,
  projectSettingsContract,
  projectSettingsDomain,
  projectWorkspacesContract,
  projectWorkspacesDomain,
  workspaceRegistryDomain,
  workspaceRegistryWireContract,
  workspacesDomain,
  workspacesWireContract,
} from '@core/features/workspaces/api';
import {
  desktopHostContract,
  desktopHostDomain,
} from '@core/primitives/desktop-host/api/host-contract';
import { loggingDomain, loggingWireContract } from '@core/primitives/logging/api/wire-contract';
import { mementosDomain, mementosWireContract } from '@core/primitives/mementos/api';
import { telemetryContract, telemetryDomain } from '@core/primitives/telemetry/api/wire-contract';
import { hostsContract, hostsDomain } from '@core/services/hosts/api';
import { notificationsContract, notificationsDomain } from '@core/services/notifications/api';
import { pullRequestsContract, pullRequestsDomain } from '@core/services/pull-requests/api';
import { appSettingsContract, appSettingsDomain } from '@core/services/settings/api';
import { sshContract, sshDomain } from '@core/services/ssh/api';

export const desktopDomainContracts = {
  [accountDomain]: accountContract,
  [agentsDomain]: agentsContract,
  [appSettingsDomain]: appSettingsContract,
  [devPerfDomain]: devPerfContract,
  [editorDomain]: editorContract,
  [filesDomain]: filesWireContract,
  [legacyPortDomain]: legacyPortContract,
  [loggingDomain]: loggingWireContract,
  [machinesDomain]: machinesContract,
  [projectSettingsDomain]: projectSettingsContract,
  [projectWorkspacesDomain]: projectWorkspacesContract,
  [promptLibraryDomain]: promptLibraryContract,
  [repositoryDomain]: repositoryContract,
  [searchDomain]: searchContract,
  [telemetryDomain]: telemetryContract,
  [sourceControlDomain]: sourceControlContract,
  [mcpDomain]: mcpContract,
  [skillsDomain]: skillsContract,
  [terminalsDomain]: terminalsContract,
  [mementosDomain]: mementosWireContract,
  [notificationsDomain]: notificationsContract,
  [pullRequestsDomain]: pullRequestsContract,
  [catalogDomain]: catalogWireContract,
  [workspacesDomain]: workspacesWireContract,
  [workspaceRegistryDomain]: workspaceRegistryWireContract,
  [lifecycleScriptsDomain]: lifecycleScriptsWireContract,
  [projectsDomain]: projectsWireContract,
  [automationsDomain]: automationsContract,
  [browserDomain]: browserContract,
  [conversationsDomain]: conversationsContract,
  [previewServersDomain]: previewServersContract,
  [githubDomain]: githubContract,
  [integrationsDomain]: integrationsContract,
  [issuesDomain]: issuesContract,
  [sshDomain]: sshContract,
  [hostsDomain]: hostsContract,
  [tasksDomain]: tasksWireContract,
  [updatesDomain]: updatesContract,
  [desktopHostDomain]: desktopHostContract,
} as const;
