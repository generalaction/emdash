import { mkdirSync } from 'node:fs';
import type { AutomationsContract } from '@emdash/core/runtimes/automations/api';
import { createAutomationsComponent } from '@emdash/core/runtimes/automations/node';
import { createScope } from '@emdash/shared/concurrency';
import type { ContractClient } from '@emdash/wire/api';
import type { WireComponentInstance } from '@emdash/wire/component';
import { getWorkspaceRuntimeClient } from '@main/core/workspaces/runtime/workspace-runtime-host';
import { getAcpRuntimeClient, getTuiAgentsRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';
import { automationRuntimePaths } from './runtime-paths';

export type AutomationsRuntimeClient = ContractClient<AutomationsContract>;

type AutomationsRuntimeHost = {
  scope: ReturnType<typeof createScope>;
  instance: WireComponentInstance<AutomationsContract>;
  client: AutomationsRuntimeClient;
};

let host: AutomationsRuntimeHost | undefined;
let hostPromise: Promise<AutomationsRuntimeHost> | undefined;

export async function getAutomationsRuntimeClient(): Promise<AutomationsRuntimeClient> {
  return (await ensureHost()).client;
}

export function disposeAutomationsRuntimeHost(): Promise<void> {
  const current = host;
  host = undefined;
  hostPromise = undefined;
  return current?.scope.dispose() ?? Promise.resolve();
}

function ensureHost(): Promise<AutomationsRuntimeHost> {
  if (host) return Promise.resolve(host);
  hostPromise ??= createHost();
  return hostPromise;
}

async function createHost(): Promise<AutomationsRuntimeHost> {
  const scope = createScope({ label: 'automations-runtime' });
  try {
    const paths = automationRuntimePaths();
    mkdirSync(paths.stateDirectory, { recursive: true });

    const [workspace, acpSessions, tuiSessions] = await Promise.all([
      getWorkspaceRuntimeClient(),
      getAcpRuntimeClient(),
      getTuiAgentsRuntimeClient(),
    ]);
    const instance = createAutomationsComponent().create({
      scope,
      dependencies: {
        workspace,
        acpSessions,
        tuiSessions,
      },
      config: { dbFile: paths.dbFile },
      logger: log,
      validate: 'inputs',
    });

    host = { scope, instance, client: instance.client };
    return host;
  } catch (error) {
    await scope.dispose();
    throw error;
  }
}
