import { join } from 'node:path';
import { createFileWorkspaceOperationRecordStore } from '@emdash/core/runtimes/workspace/node';
import { createFileSessionIntentStore } from '@emdash/core/services/session-intents/node';
import { app } from 'electron';

export type SessionIntentFilePaths = {
  acp: string;
  tuiAgents: string;
  workspaceOperationLog: string;
};

export function sessionIntentFilePaths(): SessionIntentFilePaths {
  const userData = app?.getPath?.('userData') ?? process.cwd();
  return {
    acp: join(userData, 'acp-session-intents.json'),
    tuiAgents: join(userData, 'tui-session-intents.json'),
    workspaceOperationLog: join(userData, 'workspace-operation-log.json'),
  };
}

export function createDesktopSessionIntentStores() {
  const paths = sessionIntentFilePaths();
  return {
    acp: createFileSessionIntentStore({ path: paths.acp, scope: 'acp' }),
    tuiAgents: createFileSessionIntentStore({
      path: paths.tuiAgents,
      scope: 'tui-agents',
    }),
  };
}

export function createDesktopWorkspaceOperationRecordStore() {
  return createFileWorkspaceOperationRecordStore({
    path: sessionIntentFilePaths().workspaceOperationLog,
  });
}
