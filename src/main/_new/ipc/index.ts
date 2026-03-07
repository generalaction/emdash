import { ipcMain } from 'electron';
import { worktreeController } from '../../services/worktreeIpc';
import { registerFsIpc, fsController } from '../../services/fsIpc';
import { lifecycleController, registerLifecycleEvents } from '../../services/lifecycleIpc';
import { appController, registerAppIpc } from './app';
import { githubController } from './github';
import { databaseController } from '../../ipc/dbIpc';
import { registerGitIpc, gitController } from '../../ipc/gitIpc';
import { updateController } from '../../services/updateIpc';
import { appSettingsController } from '../../ipc/settingsIpc';
import { hostPreviewController, registerHostPreviewEvents } from '../../ipc/hostPreviewIpc';
import { registerSshIpc, sshController } from '../../ipc/sshIpc';
import { jiraController } from './jiraIpc';
import { linearController } from './linearIpc';
import { connectionsController } from '../../ipc/connectionsIpc';
import { telemetryController } from '../../ipc/telemetryIpc';
import { debugController } from '../../ipc/debugIpc';
import { netController } from '../../ipc/netIpc';
import { lineCommentsController } from './line-comments';
import { skillsController } from './skills';
import { projectSettingsController } from './project-settings';
import { planLockController } from '../../services/planLockIpc';
import { browserController } from '../../ipc/browserIpc';
import { projectController as openDialogController } from '../../ipc/projectIpc';
import { createRPCRouter, registerRPCRouter } from '../../../shared/ipc/rpc';
import { projectController } from './projects';
import { taskController } from './tasks';
import { conversationController } from './conversations';
import { terminalsController } from '../core/terminals/controller';
import { filesController } from './fs';
import { ptyController, ptyController as ptySessionController } from './pty';
import { gitCtrlController } from './git';
import { dependenciesController } from './dependenciesIpc';

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
  project: openDialogController,
  ssh: sshController,
  git: gitController,
  projects: projectController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  files: filesController,
  ptySession: ptySessionController,
  gitCtrl: gitCtrlController,
  dependencies: dependenciesController,
});

export type RpcRouter = typeof rpcRouter;

export function registerAllIpc(): void {
  registerRPCRouter(rpcRouter, ipcMain);

  // Remaining manual IPC (app:undo, app:redo, app:paste require event.sender)
  registerAppIpc();

  // Event subscriptions (forward service events to renderer windows)
  registerLifecycleEvents();
  registerHostPreviewEvents();

  // fs:list (uses event.sender for per-sender worker cancellation)
  registerFsIpc();

  // SSH monitor reconnect side effects
  registerSshIpc();
}
