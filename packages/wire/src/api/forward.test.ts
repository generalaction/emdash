import { ok, type Unsubscribe } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEventStreamHost } from '../live/event-stream';
import { createLiveModelHost } from '../live/mutations';
import type { LiveSource } from '../live/protocol';
import { createTestWire, waitFor } from '../testing';
import {
  defineContract,
  downloadFile,
  eventStream,
  liveJob,
  liveLog,
  liveModel,
  liveState,
  mutation,
  uploadFile,
} from './define';
import { forwardController } from './forward';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const errorSchema = z.object({ type: z.string() });

const contract = defineContract({
  download: downloadFile({
    input: z.object({ id: z.string() }),
    error: errorSchema,
  }),
  upload: uploadFile({
    input: z.object({ id: z.string() }),
    result: z.object({ id: z.string(), text: z.string() }),
    error: errorSchema,
  }),
  output: liveLog({
    key: z.object({ id: z.string() }),
  }),
  events: eventStream({
    key: z.object({ id: z.string() }),
    event: z.object({ message: z.string() }),
  }),
  task: liveJob({
    input: z.object({ name: z.string() }),
    progress: z.object({ step: z.string() }),
    result: z.object({ artifact: z.string() }),
    error: errorSchema,
  }),
  model: liveModel({
    key: z.object({ id: z.string() }),
    states: {
      state: liveState({ data: z.object({ count: z.number() }) }),
    },
    mutations: {
      bump: mutation(
        {
          input: z.object({ amount: z.number() }),
          data: z.object({ count: z.number() }),
          error: errorSchema,
        },
        (ctx, input) => {
          let count = 0;
          ctx.produce('state', (draft) => {
            const state = draft as { count: number };
            state.count += input.amount;
            count = state.count;
          });
          return ok({ count });
        }
      ),
    },
  }),
});

describe('forwardController', () => {
  it('forwards every endpoint kind through an existing client', async () => {
    const key = { id: 'known' };
    const model = createLiveModelHost(contract.model);
    model.create(key, { state: { count: 1 } });
    const log = createLogSource('forwarded log');
    const events = createEventStreamHost(contract.events);
    const upstream = createTestWire(
      contract,
      {
        download: ({ id }) =>
          ok({
            meta: { name: `${id}.txt`, mimeType: 'text/plain', size: 11 },
            source: chunks(textEncoder.encode('hello world')),
          }),
        upload: async ({ id }, file) => ok({ id, text: textDecoder.decode(await file.bytes()) }),
        output: () => log,
        events,
        task: {
          run: async (input, ctx) => {
            ctx.progress({ step: 'package' });
            return ok({ artifact: `${input.name}.zip` });
          },
        },
        model,
      },
      { validate: 'full' }
    );
    const forwarded = createTestWire(contract, forwardController(contract, upstream.client), {
      validate: 'full',
    });

    try {
      const download = await forwarded.client.download({ id: 'known' });
      expect(download.success).toBe(true);
      if (!download.success) return;
      expect(download.data.meta).toMatchObject({ name: 'known.txt' });
      await expect(download.data.bytes()).resolves.toEqual(textEncoder.encode('hello world'));

      await expect(
        forwarded.client.upload(
          { id: 'upload' },
          {
            name: 'upload.txt',
            mimeType: 'text/plain',
            size: 7,
            source: chunks(textEncoder.encode('payload')),
          }
        )
      ).resolves.toEqual(ok({ id: 'upload', text: 'payload' }));

      await expect(forwarded.client.output.handle(key).snapshot()).resolves.toMatchObject({
        data: { text: 'forwarded log' },
      });
      const streamed: Array<{ message: string }> = [];
      const unsubscribe = forwarded.client.events.subscribe(key, {
        onEvent: (event) => streamed.push(event),
      });
      await waitFor(() => events.resolve(key).subscriberCount === 1);
      events.emit(key, { message: 'forwarded event' });
      await waitFor(() => streamed.length === 1);
      unsubscribe();
      expect(streamed).toEqual([{ message: 'forwarded event' }]);

      await expect(forwarded.client.model.state(key, 'state').snapshot()).resolves.toMatchObject({
        data: { count: 1 },
      });
      await expect(
        forwarded.client.model.mutate('bump', { key, input: { amount: 2 } })
      ).resolves.toMatchObject({ success: true, data: { data: { count: 3 } } });
      await expect(forwarded.client.model.state(key, 'state').snapshot()).resolves.toMatchObject({
        data: { count: 3 },
      });

      const { jobId } = await forwarded.client.task.start({ name: 'demo' });
      const jobSnapshot = await forwarded.client.task.handle(jobId).snapshot();
      expect(['running', 'succeeded']).toContain(jobSnapshot.data.status);
    } finally {
      forwarded.dispose();
      upstream.dispose();
      events.dispose();
      model.dispose();
    }
  });
});

function createLogSource(text: string): LiveSource {
  return {
    snapshot: () => ({
      generation: 1,
      sequence: 0,
      timestamp: 0,
      data: { baseOffset: 0, text, truncated: false },
    }),
    subscribe(): Unsubscribe {
      return () => {};
    },
  };
}

async function* chunks(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}
