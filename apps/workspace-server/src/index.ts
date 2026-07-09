import {
  formatWorkspaceServerConfigError,
  loadWorkspaceServerConfig,
  type WorkspaceServerConfig,
} from './config';
import { createWorkspaceWireController } from './api/controller';
import { serveSocket } from './wire/serve-socket';
import { serveStdio } from './wire/serve-stdio';

type Disposable = {
  dispose(): void | Promise<void>;
};

async function main(): Promise<void> {
  const config = loadWorkspaceServerConfig();
  if (!config.success) {
    throw new Error(formatWorkspaceServerConfigError(config.error));
  }

  const active = await start(config.data);
  installSignalHandlers(active);
}

async function start(config: WorkspaceServerConfig): Promise<Disposable> {
  const controller = createWorkspaceWireController({ appVersion: config.appVersion });

  if (config.serve.kind === 'socket') {
    const handle = await serveSocket(controller, { socketPath: config.serve.path });
    process.stderr.write(`workspace-server wire socket listening at ${handle.socketPath}\n`);
    return handle;
  }

  const dispose = serveStdio(controller);
  process.stderr.write('workspace-server wire stdio listening\n');
  return { dispose };
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
