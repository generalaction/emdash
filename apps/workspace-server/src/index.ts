import { createWorkspaceWireController } from './wire/controller';
import { serveSocket } from './wire/serve-socket';
import { serveStdio } from './wire/serve-stdio';

type Disposable = {
  dispose(): void | Promise<void>;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  const active = await start(mode);
  installSignalHandlers(active);
}

async function start(mode: ReturnType<typeof parseMode>): Promise<Disposable> {
  if (mode.kind === 'socket') {
    const handle = await serveSocket(createWorkspaceWireController(), { socketPath: mode.path });
    process.stderr.write(`workspace-server wire socket listening at ${handle.socketPath}\n`);
    return handle;
  }

  const dispose = serveStdio(createWorkspaceWireController());
  process.stderr.write('workspace-server wire stdio listening\n');
  return { dispose };
}

function parseMode(
  args: string[]
): { kind: 'stdio' } | { kind: 'socket'; path: string | undefined } {
  const socketIndex = args.indexOf('--socket');
  if (socketIndex !== -1) {
    const next = args[socketIndex + 1];
    return { kind: 'socket', path: next && !next.startsWith('--') ? next : undefined };
  }
  return { kind: 'stdio' };
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
