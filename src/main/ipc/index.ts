import { registerPtyIpc, ptyController } from '../services/ptyIpc';
import { worktreeController } from '../services/worktreeIpc';
import { registerFsIpc, fsController } from '../services/fsIpc';
import { lifecycleController, registerLifecycleEvents } from '../services/lifecycleIpc';
import { registerAppIpc, appController } from './appIpc';
import { githubController } from './githubIpc';
import { databaseController } from './dbIpc';
import { registerGitIpc, gitController } from './gitIpc';
import { updateController } from '../services/updateIpc';
import { appSettingsController } from './settingsIpc';
import { hostPreviewController, registerHostPreviewEvents } from './hostPreviewIpc';
import { registerSshIpc, sshController } from './sshIpc';
import { jiraController } from './jiraIpc';
import { linearController } from './linearIpc';
import { connectionsController } from './connectionsIpc';
import { telemetryController } from './telemetryIpc';
import { debugController } from './debugIpc';
import { netController } from './netIpc';
import { lineCommentsController } from './lineCommentsIpc';
import { skillsController } from './skillsIpc';
import { projectSettingsController } from './projectSettingsIpc';
import { planLockController } from '../services/planLockIpc';
import { browserController } from './browserIpc';
import { projectController } from './projectIpc';
import { createRPCRouter, registerRPCRouter } from '../../shared/ipc/rpc';
import { ipcMain } from 'electron';

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
