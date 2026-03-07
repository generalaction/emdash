import { appController } from './app';
import { githubController } from './github';
import { updateController } from '../../_deprecated/services/updateIpc';
import { appSettingsController } from './settings';
import { sshController } from './ssh';
import { jiraController } from './jiraIpc';
import { linearController } from './linearIpc';
import { lineCommentsController } from './line-comments';
import { skillsController } from './skills';
import { projectSettingsController } from './project-settings';
import { createRPCRouter } from '../../../shared/ipc/rpc';
import { projectController } from './projects';
import { taskController } from './tasks';
import { conversationController } from './conversations';
import { terminalsController } from '../core/terminals/controller';
import { filesController } from './fs';
import { ptyController } from './pty';
import { gitCtrlController } from './git';
import { dependenciesController } from './dependenciesIpc';

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
  gitCtrl: gitCtrlController,
  dependencies: dependenciesController,
});

export type RpcRouter = typeof rpcRouter;
