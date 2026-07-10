import { err, ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLiveModelHost } from '../live/mutations';
import { type LiveSource } from '../live/protocol';
import { createTestWire } from '../testing';
import { createController, encodeTopic } from './controller';
import {
  defineContract,
  downloadFile,
  liveLog,
  liveModel,
  liveState,
  mutation,
  procedure,
} from './define';
import { WireError } from './protocol';
import { withValidation } from './with-validation';

const source: LiveSource = {
  snapshot: () => ({ generation: 1, sequence: 0, timestamp: 0, data: undefined }),
  subscribe: () => () => {},
};

describe('withValidation', () => {
  it('validates procedure inputs and full-mode outputs', async () => {
    const contract = defineContract({
      echo: procedure({
        input: z.object({ value: z.string() }),
        output: z.object({ value: z.string() }),
      }),
    });
    const controller = withValidation(
      contract,
      createController(contract, {
        echo: (input) => ({ value: input.value.toUpperCase() }),
      }),
      'full'
    );

    await expect(controller.call('echo', { value: 'ok' })).resolves.toEqual({ value: 'OK' });
    await expect(controller.call('echo', { value: 1 })).rejects.toThrow();
  });

  it('rejects invalid outputs only in full mode', async () => {
    const contract = defineContract({
      invalid: procedure({ input: z.void().optional(), output: z.object({ value: z.string() }) }),
    });
    const controller = createController(contract, {
      invalid: () => ({ value: 1 }) as never,
    });

    await expect(
      withValidation(contract, controller, 'inputs').call('invalid', undefined)
    ).resolves.toEqual({ value: 1 });
    await expect(
      withValidation(contract, controller, 'full').call('invalid', undefined)
    ).rejects.toThrow();
  });

  it('validates live keys and re-encodes parsed values before resolving topics', () => {
    const contract = defineContract({
      output: liveLog({ key: z.object({ id: z.string().trim() }) }),
    });
    const seen: unknown[] = [];
    const controller = withValidation(
      contract,
      createController(contract, {
        output: (key) => {
          seen.push(key);
          return source;
        },
      }),
      'inputs'
    );

    expect(controller.resolveLive(encodeTopic(contract.output.id, { id: ' known ' }))).toBe(source);
    expect(seen).toEqual([{ id: 'known' }]);
    expect(() => controller.resolveLive(encodeTopic(contract.output.id, { id: 1 }))).toThrow();
  });

  it('validates live model mutation envelopes and outputs', async () => {
    const contract = defineContract({
      group: liveModel({
        key: z.object({ id: z.string().trim() }),
        states: { item: liveState({ data: z.object({ value: z.string() }) }) },
        mutations: {
          set: mutation({
            input: z.object({ value: z.string().trim() }),
            data: z.object({ value: z.string() }),
            error: z.object({ type: z.string() }),
          }),
        },
      }),
    });
    const host = createLiveModelHost(contract.group, {
      mutations: {
        set: (ctx, input) => {
          ctx.produce('item', (draft) => {
            (draft as { value: string }).value = input.value;
          });
          return ok({ value: input.value });
        },
      },
    });
    host.create({ id: 'known' }, { item: { value: 'old' } });
    const controller = withValidation(
      contract,
      createController(contract, { group: host }),
      'full'
    );

    await expect(
      controller.call('group.set', { key: { id: ' known ' }, input: { value: ' next ' } })
    ).resolves.toMatchObject({ success: true, data: { data: { value: 'next' } } });
    expect(host.get({ id: 'known' })?.states.item.snapshot().data).toEqual({ value: 'next' });
    await expect(
      controller.call('group.set', { key: { id: 'known' }, input: { value: 1 } })
    ).rejects.toThrow();
  });

  it('validates download file metadata while preserving blob transfer handles', async () => {
    const contract = defineContract({
      download: downloadFile({
        input: z.object({ id: z.string() }),
        meta: z.object({
          name: z.string(),
          mimeType: z.literal('text/plain'),
          size: z.number(),
        }),
        error: z.object({ type: z.string() }),
      }),
    });

    const wire = createTestWire(
      contract,
      {
        download: ({ id }) =>
          id === 'missing'
            ? err({ type: 'missing' })
            : ok({
                meta: { name: `${id}.txt`, mimeType: 'text/plain', size: 2 },
                source: chunks(new TextEncoder().encode('ok')),
              }),
      },
      { validate: 'full' }
    );

    try {
      const result = await wire.client.download({ id: 'known' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.meta).toEqual({ name: 'known.txt', mimeType: 'text/plain', size: 2 });
      await expect(result.data.bytes()).resolves.toEqual(new TextEncoder().encode('ok'));
      await expect(wire.client.download({ id: 'missing' })).resolves.toEqual(
        err({ type: 'missing' })
      );
    } finally {
      wire.dispose();
    }
  });

  it('passes unknown paths and topics through to the inner controller', async () => {
    const contract = defineContract({
      known: procedure({ input: z.void().optional(), output: z.void() }),
    });
    const controller = withValidation(
      contract,
      {
        call(path) {
          throw new WireError('UNKNOWN_PROCEDURE', path);
        },
        resolveLive(topic) {
          return topic === 'dynamic.topic' ? source : null;
        },
      },
      'full'
    );

    await expect(controller.call('unknown', undefined)).rejects.toMatchObject({
      code: 'UNKNOWN_PROCEDURE',
      message: 'unknown',
    });
    expect(controller.resolveLive('dynamic.topic')).toBe(source);
  });
});

async function* chunks(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}
