import type { Duplex } from 'node:stream';
import { streamTransport, type WireTransport } from '@emdash/wire/rpc';

/** Receive-side flow control of the underlying stream, present only when the stream supports it. */
export type TransportFlow = {
  setReceiveWindow(bytes: number): void;
  onReceived(cb: (bytes: number) => void): () => void;
};

type FlowTransport = WireTransport & { flow?: TransportFlow };
type FlowStream = Duplex & { setReceiveWindow?: (bytes: number) => void };

export function transportFlow(transport: WireTransport): TransportFlow | undefined {
  return (transport as FlowTransport).flow;
}

export function ownedStreamTransport(stream: FlowStream): FlowTransport {
  const transport = streamTransport(stream, stream);
  let closed = false;
  const owned: FlowTransport = {
    ...transport,
    close() {
      if (closed) return;
      closed = true;
      transport.close?.();
      stream.destroy();
    },
  };
  const flow = streamFlow(stream);
  return flow ? { ...owned, flow } : owned;
}

function streamFlow(stream: FlowStream): TransportFlow | undefined {
  if (typeof stream.setReceiveWindow !== 'function') return undefined;
  return {
    setReceiveWindow: (bytes) => stream.setReceiveWindow?.(bytes),
    onReceived(cb) {
      const listener = (chunk: Buffer): void => cb(chunk.length);
      stream.on('data', listener);
      return () => {
        stream.off('data', listener);
      };
    },
  };
}
