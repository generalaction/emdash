import { ipcMain } from 'electron';
import { createRPCRouter, registerRPCRouter } from '../../../shared/ipc/rpc';
import { terminalsController } from '../../core/terminals/controller';
import { conversationController } from '../../ipc/conversations';
import { filesController } from '../../ipc/fs';
import { gitController } from '../../ipc/git';
import { githubController } from '../../ipc/github';
import { jiraController } from '../../ipc/jiraIpc';
import { lineCommentsController } from '../../ipc/line-comments';
import { linearController } from '../../ipc/linearIpc';
import { projectSettingsController } from '../../ipc/project-settings';
import { projectController as projectsController } from '../../ipc/projects';
import { ptyController as ptySessionController } from '../../ipc/pty';
import { skillsController } from '../../ipc/skills';
import { taskController } from '../../ipc/tasks';
import { fsController, registerFsIpc } from '../services/fsIpc';
import { lifecycleController, registerLifecycleEvents } from '../services/lifecycleIpc';
import { planLockController } from '../services/planLockIpc';
import { ptyController, registerPtyIpc } from '../services/ptyIpc';
import { updateController } from '../services/updateIpc';
import { worktreeController } from '../services/worktreeIpc';
import { appController, registerAppIpc } from './appIpc';
import { browserController } from './browserIpc';
import { connectionsController } from './connectionsIpc';
import { databaseController } from './dbIpc';
import { debugController } from './debugIpc';
import { gitController, registerGitIpc } from './gitIpc';
import { hostPreviewController, registerHostPreviewEvents } from './hostPreviewIpc';
import { netController } from './netIpc';
import { projectController } from './projectIpc';
import { appSettingsController } from './settingsIpc';
import { registerSshIpc, sshController } from './sshIpc';
import { telemetryController } from './telemetryIpc';

export const rpcRouter = createRPCRouter({
  db: databaseController,
  appSettings: appSettingsController,
  app: appController,
  worktree: worktreeController,
  fs: fsController,
  lifecycle: lifecycleController,
  update: updateController,
  hostPreview: hostPreviewController,
  pty: ptyController,
  github: githubController,
  jira: jiraController,
  linear: linearController,
  connections: connectionsController,
  telemetry: telemetryController,
  debug: debugController,
  net: netController,
  lineComments: lineCommentsController,
  skills: skillsController,
  projectSettings: projectSettingsController,
  planLock: planLockController,
  browser: browserController,
  project: projectController,
  ssh: sshController,
  git: gitController,
  projects: projectsController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  files: filesController,
  ptySession: ptySessionController,
  gitCtrl: gitController,
});

export type RpcRouter = typeof rpcRouter;

export function registerAllIpc() {
  // Register RPC router
  registerRPCRouter(rpcRouter, ipcMain);

  // Remaining manual IPC (app:undo, app:redo, app:paste require event.sender)
  registerAppIpc();

  // Event subscriptions (forward service events to renderer windows)
  registerLifecycleEvents();
  registerHostPreviewEvents();

  // fs:list (uses event.sender for per-sender worker cancellation)
  registerFsIpc();

  // PTY IPC (pty:start, pty:startDirect use event.sender; pty:input/resize/kill are fire-and-forget)
  registerPtyIpc();

  // registerGitIpc is now a no-op (all handlers migrated to gitController)
  registerGitIpc();

  // SSH monitor reconnect side effects
  registerSshIpc();
}
