import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { client } from '../../api/client';
import { connect } from '../../api/connect';
import { createController } from '../../api/controller';
import { defineContract, liveLog } from '../../api/define';
import { serve } from '../../api/serve';
import { memoryTransportPair } from '../../api/transports';
import { LiveLog } from '../log';
import { createLiveLogReplica } from './log';

const api = defineContract({
  output: liveLog({ key: z.object({ id: z.string() }) }),
});

describe('createLiveLogReplica', () => {
  it('seeds retained text and passes through appends under local cursors', async () => {
    const key = { id: 'session' };
    const log = new LiveLog({ generation: 1000 });
    log.append('seed\n');
    const pair = memoryTransportPair();
    serve(pair.right, createController(api, { output: () => log }));
    const contractClient = client(api, connect(pair.left));

    const replica = createLiveLogReplica(api.output, contractClient.output);
    const lease = replica.acquire(key);
    const output = await lease.ready();
    const appends: string[] = [];
    output.onAppend((chunk) => appends.push(chunk));

    expect(output.text()).toBe('seed\n');
    log.append('next\n');
    await waitFor(() => appends.length === 1);

    expect(appends).toEqual(['next\n']);
    expect((await output.snapshot()).data.text).toBe('seed\nnext\n');

    await lease.release();
    await replica.dispose();
  });

  it('writes through to a custom log store', async () => {
    const key = { id: 'session' };
    const log = new LiveLog({ generation: 1000 });
    log.append('seed');
    const pair = memoryTransportPair();
    serve(pair.right, createController(api, { output: () => log }));
    const contractClient = client(api, connect(pair.left));
    let text = '';

    const replica = createLiveLogReplica(api.output, contractClient.output, {
      store: () => ({
        reset: (data) => {
          text = data.text;
        },
        append: (chunk) => {
          text += chunk;
        },
        text: () => text,
      }),
    });
    const lease = replica.acquire(key);
    const output = await lease.ready();

    expect(output.text()).toBe('seed');
    log.append('\nnext');
    await waitFor(() => output.text() === 'seed\nnext');

    await lease.release();
    await replica.dispose();
  });

  it('supports write-only log sinks without readable text', async () => {
    const key = { id: 'session' };
    const log = new LiveLog({ generation: 1000 });
    log.append('seed');
    const pair = memoryTransportPair();
    serve(pair.right, createController(api, { output: () => log }));
    const contractClient = client(api, connect(pair.left));
    const writes: string[] = [];

    const replica = createLiveLogReplica(api.output, contractClient.output, {
      store: () => ({
        reset: (data) => {
          writes.push(`reset:${data.text}`);
        },
        append: (chunk) => {
          writes.push(`append:${chunk}`);
        },
      }),
    });
    const lease = replica.acquire(key);
    const output = await lease.ready();

    expect(() => output.text()).toThrow('write-only LogSink');
    log.append('\nnext');
    await waitFor(() => writes.length === 2);
    expect(writes).toEqual(['reset:seed', 'append:\nnext']);

    await lease.release();
    await replica.dispose();
  });

  it('serves downstream clients from the local log buffer', async () => {
    const key = { id: 'session' };
    const log = new LiveLog({ generation: 1000 });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, createController(api, { output: () => log }));
    const upstream = client(api, connect(upstreamPair.left));
    const replica = createLiveLogReplica(api.output, upstream.output);
    const downstreamPair = memoryTransportPair();
    serve(downstreamPair.right, createController(api, { output: replica }));
    const downstream = client(api, connect(downstreamPair.left));

    const handle = downstream.output.handle(key);
    const updates: string[] = [];
    const detach = await handle.attach((update) => {
      updates.push((update.delta as { chunk: string }).chunk);
    });
    await handle.snapshot();
    log.append('served\n');
    await waitFor(() => updates.length === 1);

    expect((await handle.snapshot()).data.text).toBe('served\n');

    detach();
    await replica.dispose();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}
