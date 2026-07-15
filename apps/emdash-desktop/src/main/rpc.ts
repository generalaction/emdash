import { createRPCNamespace, createRPCRouter } from '../shared/lib/ipc/rpc';
import { accountController } from './core/account/controller';
import { agentsController } from './core/agents/controller';
import { appController } from './core/app/controller';
import { automationsController } from './core/automations/controller';
import { browserController } from './core/browser/controller';
import { conversationController } from './core/conversations/controller';
import { editorBufferController } from './core/editor/controller';
import { githubController } from './core/github/controller';
import { integrationsController } from './core/integrations/controller';
import { issueController } from './core/issues/controller';
import { previewServersController } from './core/preview-servers/controller';
import { projectController } from './core/projects/controller';
import { promptLibraryController } from './core/prompt-library/controller';
import { pullRequestController } from './core/pull-requests/controller';
import { repositoryController } from './core/repository/controller';
import { searchController } from './core/search/controller';
import { appSettingsController } from './core/settings/controller';
import { providerSettingsController } from './core/settings/provider-settings-controller';
import { sshController } from './core/ssh/controller';
import { taskController } from './core/tasks/controller';
import { telemetryController } from './core/telemetry/controller';
import { updateController } from './core/updates/controller';
import { viewStateController } from './core/view-state/controller';
import { projectSettingsController } from './core/workspaces/project-settings-controller';
import { projectWorkspacesController } from './core/workspaces/project-workspaces-controller';
import { legacyPortController } from './db/legacy-port/controller';

export const rpcRouter = createRPCRouter({
  account: accountController,
  agents: agentsController,
  legacyPort: legacyPortController,
  app: appController,
  automations: automationsController,
  appSettings: appSettingsController,
  providerSettings: providerSettingsController,
  browser: browserController,
  repository: repositoryController,
  update: updateController,
  github: githubController,
  integrations: integrationsController,
  issues: issueController,
  promptLibrary: promptLibraryController,
  ssh: sshController,
  projects: projectController,
  previewServers: previewServersController,
  tasks: taskController,
  conversations: conversationController,
  telemetry: telemetryController,
  pullRequests: pullRequestController,
  viewState: viewStateController,
  search: searchController,
  projectWorkspaces: projectWorkspacesController,
  projectSettings: projectSettingsController,
  workspace: createRPCNamespace({
    editor: editorBufferController,
  }),
});

export type RpcRouter = typeof rpcRouter;
