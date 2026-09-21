/**
 * WebSocket wire gateway for the Emdash web server.
 *
 * Bridges browser WebSocket connections onto the same `streamTransport`
 * framing the workspace-server uses (JSON frames + length-prefixed binary
 * blob-chunk frames), then serves the desktop wire controller bundle over
 * each connection. Domain routing replicates the desktop gateway: paths are
 * `<domain>.<rest>` and dispatch to the matching domain controller.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@emdash/wire/rpc';
import { streamTransport } from '@emdash/wire/rpc';
import type { Controller } from '@emdash/wire/rpc';
import { WebSocketServer, type WebSocket } from 'ws';

function route(path: string, controllers: Record<string, Controller>) {
  const [prefix, ...rest] = path.split('.');
  const controller = controllers[prefix];
  if (!controller || rest.length === 0) {
    throw new Error(`Unknown desktop wire path '${path}'`);
  }
  return { controller, path: rest.join('.') };
}

export function createRoutingController(controllers: Record<string, Controller>): Controller {
  return {
    async call(path, input, meta) {
      const routed = route(path, controllers);
      return await routed.controller.call(routed.path, input, meta);
    },
    resolveLive(topic) {
      const routed = route(topic, controllers);
      return routed.controller.resolveLive(routed.path);
    },
    acquireLive(topic) {
      const routed = route(topic, controllers);
      return routed.controller.acquireLive(routed.path);
    },
  };
}

/** Adapts a connected `ws` socket to the ReadableLike/WritableLike pair streamTransport expects. */
function wsStreamAdapter(ws: WebSocket): {
  input: {
    on(event: string, cb: (chunk: Uint8Array | string) => void): unknown;
  };
  output: { write(chunk: string | Uint8Array): unknown };
} {
  const dataListeners = new Set<(chunk: Uint8Array | string) => void>();
  const closeListeners = new Set<() => void>();
  ws.on('message', (chunk: Buffer) => {
    for (const listener of dataListeners) listener(chunk);
  });
  ws.on('close', () => {
    for (const listener of closeListeners) listener();
  });
  ws.on('error', () => {
    for (const listener of closeListeners) listener();
  });
  return {
    input: {
      on(event: string, cb: (chunk: Uint8Array | string) => void): unknown {
        if (event === 'data') dataListeners.add(cb);
        else closeListeners.add(cb as () => void);
        return this;
      },
    },
    output: {
      write(chunk: string | Uint8Array): unknown {
        ws.send(chunk as Buffer);
        return true;
      },
    },
  };
}

export type GatewayOptions = {
  /** Required bearer-style token; connections without a match are rejected. */
  token: string;
  controllers: Record<string, Controller>;
  path?: string;
};

export function attachWireGateway(
  server: {
    on(
      event: 'upgrade',
      listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
    ): void;
  },
  options: GatewayOptions
): void {
  const wss = new WebSocketServer({ noServer: true });
  const controller = createRoutingController(options.controllers);

  server.on('upgrade', (request, socket, head) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname !== (options.path ?? '/ws')) {
      socket.destroy();
      return;
    }
    const token = searchParams.get('token');
    if (!options.token || token !== options.token) {
      // Complete the upgrade, then close with a custom code: browsers cannot
      // observe pre-upgrade HTTP status on WebSocket failures, but they do
      // surface post-upgrade close codes — the client treats 4401 as a
      // terminal auth failure, clears its stored token, and re-prompts.
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.close(4401, 'unauthorized');
      });
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const { input, output } = wsStreamAdapter(ws);
    const dispose = serve(streamTransport(input, output), controller);
    ws.on('close', () => dispose());
  });
}
