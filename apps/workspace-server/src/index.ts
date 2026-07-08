import { createServer } from 'node:http';
import { RPCHandler } from '@orpc/server/node';
import { router } from './router';
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
  if (mode.kind === 'stdio') {
    const dispose = serveStdio(createWorkspaceWireController());
    process.stderr.write('workspace-server wire stdio listening\n');
    return { dispose };
  }

  if (mode.kind === 'socket') {
    const handle = await serveSocket(createWorkspaceWireController(), { socketPath: mode.path });
    process.stderr.write(`workspace-server wire socket listening at ${handle.socketPath}\n`);
    return handle;
  }

  return startHttpServer();
}

function startHttpServer(): Disposable {
  const port = Number(process.env['EMDASH_WORKSPACE_SERVER_PORT'] ?? 8787);
  const handler = new RPCHandler(router);
  const server = createServer(async (req, res) => {
    const { matched } = await handler.handle(req, res, { prefix: '/rpc', context: {} });
    if (!matched) {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    process.stdout.write(`workspace-server listening on :${port}\n`);
  });

  return {
    dispose: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function parseMode(
  args: string[]
): { kind: 'http' } | { kind: 'stdio' } | { kind: 'socket'; path: string | undefined } {
  if (args.includes('--stdio')) return { kind: 'stdio' };
  const socketIndex = args.indexOf('--socket');
  if (socketIndex !== -1) {
    const next = args[socketIndex + 1];
    return { kind: 'socket', path: next && !next.startsWith('--') ? next : undefined };
  }
  return { kind: 'http' };
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
