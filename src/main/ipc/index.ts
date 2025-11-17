import { registerPtyIpc } from '../services/ptyIpc';
import { registerWorktreeIpc } from '../services/worktreeIpc';
import { registerFsIpc } from '../services/fsIpc';
import { setupCodexIpc } from '../services/codexIpc';

import { registerAppIpc } from './appIpc';
import { registerProjectIpc } from './projectIpc';
import { registerGithubIpc } from './githubIpc';
import { registerDatabaseIpc } from './dbIpc';
import { registerDebugIpc } from './debugIpc';
import { registerGitIpc } from './gitIpc';
import { registerAgentIpc } from './agentIpc';
import { registerLinearIpc } from './linearIpc';
import { registerConnectionsIpc } from './connectionsIpc';
import { registerUpdateIpc } from '../services/updateIpc';
import { registerTelemetryIpc } from './telemetryIpc';
import { registerJiraIpc } from './jiraIpc';
import { registerPlanLockIpc } from '../services/planLockIpc';
import { registerSettingsIpc } from './settingsIpc';
import { registerContainerIpc } from './containerIpc';
import { registerHostPreviewIpc } from './hostPreviewIpc';
import { registerBrowserIpc } from './browserIpc';
import { registerNetIpc } from './netIpc';

export function registerAllIpc() {
  // Core app/utility IPC
  registerAppIpc();
  registerDebugIpc();
  registerTelemetryIpc();
  registerUpdateIpc();
  registerSettingsIpc();

  // Domain IPC
  registerProjectIpc();
  registerGithubIpc();
  registerDatabaseIpc();
  registerGitIpc();
  registerContainerIpc();
  registerHostPreviewIpc();
  registerBrowserIpc();
  registerNetIpc();

  // Existing modules
  registerPtyIpc();
  registerWorktreeIpc();
  registerFsIpc();
  setupCodexIpc();
  registerAgentIpc();
  registerLinearIpc();
  registerConnectionsIpc();
  registerJiraIpc();
  registerPlanLockIpc();
}
