import { dirname, join } from 'node:path';
import { createJsonFileKeyValueStore } from '@emdash/core/primitives/kv/node';
import { terminalsComponent } from '@emdash/core/runtimes/terminals/node';
import type { WorkspaceContract } from '@emdash/core/runtimes/workspace/api';
import { workspaceComponent } from '@emdash/core/runtimes/workspace/node';
import { buildDescriptorFromProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import { NodeExecutionContext } from '@emdash/core/services/exec/api';
import { fsWatchComponent } from '@emdash/core/services/fs-watch/node';
import {
  CORE_DEPENDENCIES,
  createHostDependenciesComponent,
} from '@emdash/core/services/host-dependencies/node';
import { workspaceWireContract } from '@emdash/core/workspace-server';
import { pluginRegistry } from '@emdash/plugins/agents';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { withValidation, type ValidatePolicy } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { createWireWorkerHost } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { defineAcpWorkspaceRuntimeWorker } from './acp/host';
import { createWorkspaceWireController } from './api/controller';
import {
  formatWorkspaceServerConfigError,
  loadWorkspaceServerConfig,
  type WorkspaceServerConfig,
} from './config';
import { daemonPaths } from './daemon/paths';
import { removePidFile, writePidFile } from './daemon/pid-file';
import { startDaemon } from './daemon/start';
import { statusDaemon } from './daemon/status';
import { stopDaemon } from './daemon/stop';
import { serveSocket } from './wire/serve-socket';
import { serveStdio } from './wire/serve-stdio';

type Disposable = {
  dispose(): void | Promise<void>;
};

type WorkspaceRuntime = {
  workspace: ContractClient<WorkspaceContract>;
};

async function main(): Promise<void> {
  initProcessLogging({ name: 'workspace-server' });
  const config = loadWorkspaceServerConfig();
  if (!config.success) {
    throw new Error(formatWorkspaceServerConfigError(config.error));
  }

  switch (config.data.command) {
    case 'serve': {
      const active = await serve(config.data);
      installSignalHandlers(active);
      break;
    }
    case 'start':
      await runStart(config.data);
      break;
    case 'stop':
      await runStop(config.data);
      break;
    case 'status':
      await runStatus(config.data);
      break;
  }
}

async function serve(config: WorkspaceServerConfig): Promise<Disposable> {
  if (config.serve.kind === 'socket') {
    const scope = createScope({ label: 'workspace-server' });
    const workerHost = createWireWorkerHost({
      scope: scope.child('workers'),
      processSpawner: childProcessSpawner(),
    });
    const runtime = createWorkspaceServerRuntime(scope);
    const initialPaths = daemonPaths(config.serve.path);
    const hostDependencies = createWorkspaceHostDependencies(scope, initialPaths.socketPath);
    const acpWorker = defineAcpWorkspaceRuntimeWorker(workerHost, {
      socketPath: config.serve.path,
      hostDependencies: hostDependencies.client.resolver,
    });
    let acpClient: Awaited<ReturnType<typeof acpWorker.ready>> | undefined;
    try {
      acpClient = await acpWorker.ready();
    } catch (error) {
      process.stderr.write(
        `workspace-server ACP runtime failed to start: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
    }

    const controller = withValidation(
      workspaceWireContract,
      createWorkspaceWireController({
        appVersion: config.appVersion,
        acp: acpClient,
        hostDependencies: hostDependencies.client,
        workspace: runtime.workspace,
      }),
      workspaceServerWireValidationPolicy()
    );
    const handle = await serveSocket(controller, { socketPath: config.serve.path });
    scope.add(() => handle.dispose());
    const paths = daemonPaths(handle.socketPath);
    try {
      await writePidFile(paths.pidPath);
    } catch (error) {
      await scope.dispose();
      throw error;
    }
    process.stderr.write(`workspace-server wire socket listening at ${handle.socketPath}\n`);
    return {
      async dispose() {
        await removePidFile(paths.pidPath);
        await scope.dispose();
      },
    };
  }

  const scope = createScope({ label: 'workspace-server-stdio' });
  const runtime = createWorkspaceServerRuntime(scope);
  const controller = withValidation(
    workspaceWireContract,
    createWorkspaceWireController({
      appVersion: config.appVersion,
      workspace: runtime.workspace,
    }),
    workspaceServerWireValidationPolicy()
  );
  const dispose = serveStdio(controller);
  process.stderr.write('workspace-server wire stdio listening\n');
  return {
    async dispose() {
      dispose();
      await scope.dispose();
    },
  };
}

function createWorkspaceServerRuntime(scope: Scope): WorkspaceRuntime {
  const watcher = fsWatchComponent.create({
    scope,
    dependencies: {},
    config: {},
    validate: workspaceServerWireValidationPolicy(),
  });
  const terminals = terminalsComponent.create({
    scope,
    dependencies: {},
    config: {},
    validate: workspaceServerWireValidationPolicy(),
  });
  const workspace = workspaceComponent.create({
    scope,
    dependencies: {
      terminals: terminals.client,
      watcher: watcher.client,
    },
    config: {},
    validate: workspaceServerWireValidationPolicy(),
  });
  return { workspace: workspace.client };
}

function createWorkspaceHostDependencies(scope: Scope, socketPath: string) {
  const root = dirname(dirname(socketPath));
  const store = createJsonFileKeyValueStore({
    path: join(root, 'state', 'kv.json'),
  });
  return createHostDependenciesComponent({
    store,
    exec: new NodeExecutionContext({ env: process.env }),
  }).create({
    scope,
    dependencies: {},
    config: {
      hostId: 'local',
      definitions: [
        ...CORE_DEPENDENCIES,
        ...pluginRegistry.getAll().map(buildDescriptorFromProvider),
      ],
    },
    validate: workspaceServerWireValidationPolicy(),
  });
}

function workspaceServerWireValidationPolicy(): ValidatePolicy {
  return process.env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

async function runStart(config: WorkspaceServerConfig): Promise<void> {
  if (config.serve.kind !== 'socket') throw new Error('start only supports socket mode');
  const result = await startDaemon({ socketPath: config.serve.path });
  if (!result.success) throw new Error(result.error.message);
  process.stdout.write(
    `workspace-server daemon ${result.data.status} at ${result.data.paths.socketPath}\n`
  );
}

async function runStop(config: WorkspaceServerConfig): Promise<void> {
  if (config.serve.kind !== 'socket') throw new Error('stop only supports socket mode');
  const result = await stopDaemon({ socketPath: config.serve.path });
  if (!result.success) throw new Error(result.error.message);
  process.stdout.write(
    result.data.status === 'stopped'
      ? `workspace-server daemon stopped at ${result.data.paths.socketPath}\n`
      : `workspace-server daemon not running at ${result.data.paths.socketPath}\n`
  );
}

async function runStatus(config: WorkspaceServerConfig): Promise<void> {
  if (config.serve.kind !== 'socket') throw new Error('status only supports socket mode');
  const result = await statusDaemon(config.serve.path);
  if (!result.success) {
    process.stderr.write(
      `workspace-server daemon ${result.error.type} at ${result.error.paths.socketPath}: ${result.error.message}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `workspace-server daemon running at ${result.data.paths.socketPath} ` +
      `(version ${result.data.health.version}, uptime ${result.data.health.uptimeMs}ms)\n`
  );
}

function installSignalHandlers(active: Disposable): void {
  let disposing = false;
  const disposeAndExit = (signal: NodeJS.Signals): void => {
    if (disposing) return;
    disposing = true;
    Promise.resolve(active.dispose()).finally(() => {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  };
  process.once('SIGINT', disposeAndExit);
  process.once('SIGTERM', disposeAndExit);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `workspace-server failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
