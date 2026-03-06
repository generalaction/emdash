import { registerPtyIpc } from '../services/ptyIpc';
import { registerWorktreeIpc } from '../services/worktreeIpc';
import { registerFsIpc } from '../services/fsIpc';
import { registerLifecycleIpc } from '../services/lifecycleIpc';
import { registerAppIpc } from './appIpc';
import { registerProjectIpc } from './projectIpc';
import { registerProjectSettingsIpc } from './projectSettingsIpc';
import { registerGithubIpc } from './githubIpc';
import { databaseController } from './dbIpc';
import { registerDebugIpc } from './debugIpc';
import { registerGitIpc } from './gitIpc';
import { registerLinearIpc } from './linearIpc';
import { registerConnectionsIpc } from './connectionsIpc';
import { registerUpdateIpc } from '../services/updateIpc';
import { registerTelemetryIpc } from './telemetryIpc';
import { registerJiraIpc } from './jiraIpc';
import { registerPlanLockIpc } from '../services/planLockIpc';
import { appSettingsController } from './settingsIpc';
import { registerHostPreviewIpc } from './hostPreviewIpc';
import { registerBrowserIpc } from './browserIpc';
import { registerNetIpc } from './netIpc';
import { registerLineCommentsIpc } from './lineCommentsIpc';
import { registerSshIpc } from './sshIpc';
import { registerSkillsIpc } from './skillsIpc';
import { registerMcpIpc } from './mcpIpc';
import { createRPCRouter, registerRPCRouter } from '../../shared/ipc/rpc';
import { ipcMain } from 'electron';
import { registerGitlabIpc } from './gitlabIpc';
import { registerPlainIpc } from './plainIpc';

export const rpcRouter = createRPCRouter({
  db: databaseController,
  appSettings: appSettingsController,
});

export type RpcRouter = typeof rpcRouter;

export function registerAllIpc() {
  // Register RPC
  registerRPCRouter(rpcRouter, ipcMain);

  // Core app/utility IPC
  registerAppIpc();
  registerDebugIpc();
  registerTelemetryIpc();
  registerUpdateIpc();

  // Domain IPC
  registerProjectIpc();
  registerProjectSettingsIpc();
  registerGithubIpc();
  registerGitIpc();
  registerHostPreviewIpc();
  registerBrowserIpc();
  registerNetIpc();
  registerLineCommentsIpc();

  // Existing modules
  registerPtyIpc();
  registerWorktreeIpc();
  registerFsIpc();
  registerLifecycleIpc();
  registerLinearIpc();
  registerConnectionsIpc();
  registerJiraIpc();
  registerPlanLockIpc();
  registerSshIpc();
  registerSkillsIpc();
  registerMcpIpc();
  registerGitlabIpc();
  registerPlainIpc();
}
