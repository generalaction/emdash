import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { IAcpBehavior } from '../capabilities/acp';

/**
 * Standard behavior for CLIs that speak ACP directly over stdio.
 */
export function nativeAcpBehavior(args: string[]): IAcpBehavior {
  return {
    buildSpawn: (ctx) => ({
      command: ctx.cli,
      args,
    }),
    connect: (io, toClient) => {
      const stream = ndJsonStream(
        Writable.toWeb(io.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(io.stdout) as unknown as ReadableStream<Uint8Array>
      );
      return new ClientSideConnection((agent) => toClient(agent as never), stream);
    },
  };
}
