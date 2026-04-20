import { createRPCRouter } from '../shared/ipc/rpc';
import { accountController } from './core/account/controller';
import { appController } from './core/app/controller';
import { conversationController } from './core/conversations/controller';
import { dependenciesController } from './core/dependencies/controller';
import { editorBufferController } from './core/editor/controller';
import { forgejoController } from './core/forgejo/controller';
import { filesController } from './core/fs/controller';
import { gitController } from './core/git/controller';
import { githubController } from './core/github/controller';
import { gitlabController } from './core/gitlab/controller';
import { issueController } from './core/issues/controller';
import { jiraController } from './core/jira/controller';
import { linearController } from './core/linear/controller';
import { mcpController } from './core/mcp/controller';
import { plainController } from './core/plain/controller';
import { projectController } from './core/projects/controller';
import { ptyController } from './core/pty/controller';
import { pullRequestController } from './core/pull-requests/controller';
import { repositoryController } from './core/repository/controller';
import { resourceMonitorController } from './core/resource-monitor/controller';
import { appSettingsController } from './core/settings/controller';
import { providerSettingsController } from './core/settings/provider-settings-controller';
import { skillsController } from './core/skills/controller';
import { sshController } from './core/ssh/controller';
import { taskController } from './core/tasks/controller';
import { telemetryController } from './core/telemetry/controller';
import { terminalsController } from './core/terminals/controller';
import { updateController } from './core/updates/controller';
import { viewStateController } from './core/view-state/controller';
import { legacyPortController } from './db/legacy-port/controller';

export const rpcRouter = createRPCRouter({
  account: accountController,
  legacyPort: legacyPortController,
  app: appController,
  appSettings: appSettingsController,
  providerSettings: providerSettingsController,
  repository: repositoryController,
  fs: filesController,
  update: updateController,
  pty: ptyController,
  resourceMonitor: resourceMonitorController,
  forgejo: forgejoController,
  github: githubController,
  gitlab: gitlabController,
  issues: issueController,
  jira: jiraController,
  linear: linearController,
  plain: plainController,
  skills: skillsController,
  ssh: sshController,
  projects: projectController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  git: gitController,
  dependencies: dependenciesController,
  mcp: mcpController,
  editorBuffer: editorBufferController,
  telemetry: telemetryController,
  pullRequests: pullRequestController,
  viewState: viewStateController,
});

export type RpcRouter = typeof rpcRouter;
