import { createRPCRouter } from '../../shared/ipc/rpc';
import { terminalsController } from '../core/terminals/controller';
import { appController } from './app';
import { conversationController } from './conversations';
import { dependenciesController } from './dependenciesIpc';
import { filesController } from './fs';
import { gitController } from './git';
import { githubController } from './github';
import { jiraController } from './jiraIpc';
import { lineCommentsController } from './line-comments';
import { linearController } from './linearIpc';
import { projectSettingsController } from './project-settings';
import { projectController } from './projects';
import { ptyController } from './pty';
import { appSettingsController } from './settings';
import { skillsController } from './skills';
import { sshController } from './ssh';
import { taskController } from './tasks';
import { updateController } from './updateIpc';

export const rpcRouter = createRPCRouter({
  appSettings: appSettingsController,
  app: appController,
  fs: filesController,
  update: updateController,
  pty: ptyController,
  github: githubController,
  jira: jiraController,
  linear: linearController,
  lineComments: lineCommentsController,
  skills: skillsController,
  projectSettings: projectSettingsController,
  ssh: sshController,
  projects: projectController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  git: gitController,
  dependencies: dependenciesController,
});

export type RpcRouter = typeof rpcRouter;
