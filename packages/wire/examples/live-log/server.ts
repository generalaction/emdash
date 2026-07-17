import type { Unsubscribe } from '@emdash/shared';
import { LiveLog } from '../../src/live/log/index';
import type { LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '../../src/live/protocol/index';

const server = new LiveLog({ generation: 3000, maxBufferBytes: 12 });

export async function fetchSnapshot(): Promise<LiveSnapshot<LiveLogSnapshotData>> {
  return server.snapshot();
}

export function attach(push: (update: LiveUpdate) => void): Unsubscribe {
  return server.subscribe(push);
}

export function appendLine(line: string): void {
  server.append(`${line}\n`);
}
