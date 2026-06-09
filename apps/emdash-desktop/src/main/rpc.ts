import { createRPCNamespace, createRPCRouter } from '../shared/lib/ipc/rpc';
import { accountController } from './core/account/controller';
import { appController } from './core/app/controller';
import { asanaController } from './core/asana/controller';
import { automationsController } from './core/automations/controller';
import { browserController } from './core/browser/controller';
import { conversationController } from './core/conversations/controller';
import { dependenciesController } from './core/dependencies/controller';
import { editorBufferController } from './core/editor/controller';
import { featurebaseController } from './core/featurebase/controller';
import { forgejoController } from './core/forgejo/controller';
import { filesController } from './core/fs/controller';
import { gitController } from './core/git/controller';
import { githubController } from './core/github/controller';
import { gitlabController } from './core/gitlab/controller';
import { issueController } from './core/issues/controller';
import { jiraController } from './core/jira/controller';
import { linearController } from './core/linear/controller';
import { mcpController } from './core/mcp/controller';
import { mondayController } from './core/monday/controller';
import { plainController } from './core/plain/controller';
import { planeController } from './core/plane/controller';
import { projectController } from './core/projects/controller';
import { promptLibraryController } from './core/prompt-library/controller';
import { ptyController } from './core/pty/controller';
import { pullRequestController } from './core/pull-requests/controller';
import { repositoryController } from './core/repository/controller';
import { resourceMonitorController } from './core/resource-monitor/controller';
import { searchController } from './core/search/controller';
import { appSettingsController } from './core/settings/controller';
import { providerSettingsController } from './core/settings/provider-settings-controller';
import { skillsController } from './core/skills/controller';
import { sshController } from './core/ssh/controller';
import { taskController } from './core/tasks/controller';
import { telemetryController } from './core/telemetry/controller';
import { terminalsController } from './core/terminals/controller';
import { trelloController } from './core/trello/controller';
import { updateController } from './core/updates/controller';
import { viewStateController } from './core/view-state/controller';
import { projectSettingsController } from './core/workspaces/project-settings-controller';
import { legacyPortController } from './db/legacy-port/controller';

export const rpcRouter = createRPCRouter({
  account: accountController,
  legacyPort: legacyPortController,
  app: appController,
  automations: automationsController,
  appSettings: appSettingsController,
  providerSettings: providerSettingsController,
  browser: browserController,
  repository: repositoryController,
  update: updateController,
  pty: ptyController,
  resourceMonitor: resourceMonitorController,
  asana: asanaController,
  featurebase: featurebaseController,
  forgejo: forgejoController,
  github: githubController,
  gitlab: gitlabController,
  issues: issueController,
  jira: jiraController,
  linear: linearController,
  monday: mondayController,
  plane: planeController,
  plain: plainController,
  trello: trelloController,
  promptLibrary: promptLibraryController,
  skills: skillsController,
  ssh: sshController,
  projects: projectController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  dependencies: dependenciesController,
  mcp: mcpController,
  telemetry: telemetryController,
  pullRequests: pullRequestController,
  viewState: viewStateController,
  search: searchController,
  projectSettings: projectSettingsController,
  workspace: createRPCNamespace({
    git: gitController,
    fs: filesController,
    editor: editorBufferController,
  }),
});

export type RpcRouter = typeof rpcRouter;
