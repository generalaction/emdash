import { createRPCRouter } from '../shared/ipc/rpc';
import { projectSettingsController } from './_deprecated/_project-settings';
import { appController } from './core/app/app';
import { conversationController } from './core/conversations/controller';
import { dependenciesController } from './core/dependencies/controller';
import { filesController } from './core/fs/controller';
import { gitController } from './core/git/controller';
import { githubController } from './core/github/controller';
import { jiraController } from './core/jira/controller';
import { lineCommentsController } from './core/line-comments';
import { linearController } from './core/linear/controller';
import { projectController } from './core/projects/controller';
import { ptyController } from './core/pty/controller';
import { appSettingsController } from './core/settings/controller';
import { skillsController } from './core/skills/controller';
import { sshController } from './core/ssh/controller';
import { taskController } from './core/tasks/controller';
import { terminalsController } from './core/terminals/controller';
import { updateController } from './core/updates/controller';

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
