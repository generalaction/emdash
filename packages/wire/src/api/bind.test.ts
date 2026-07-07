import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModelServer } from '../live/model';
import { liveModelRef } from '../live/mutations';
import { bind, encodeTopic, mergeControllers, splitTopic } from './bind';
import { defineContract, liveLogRef, procedure } from './define';
import type { WireError } from './protocol';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });
const outputSchema = z.object({ value: z.string() });

function makeContract(prefix = 'test') {
  return defineContract({
    procedures: {
      echo: procedure({ input: z.object({ value: z.string() }), output: outputSchema }),
    },
    models: {
      state: liveModelRef(`${prefix}.state`, keySchema, stateSchema),
    },
    logs: {
      output: liveLogRef(`${prefix}.output`, keySchema),
    },
  });
}

describe('bind', () => {
  it('validates inputs and outputs according to policy', async () => {
    const contract = makeContract();
    const controller = bind(
      contract,
      {
        procedures: {
          echo: (input) => ({ value: input.value.toUpperCase() }),
        },
        live: {
          models: { state: () => null },
          logs: { output: () => null },
        },
      },
      { validate: 'full' }
    );

    await expect(controller.call('echo', { value: 'ok' })).resolves.toEqual({ value: 'OK' });
    await expect(controller.call('echo', { value: 1 })).rejects.toThrow();
  });

  it('routes live topics through encoded keys', () => {
    const contract = makeContract();
    const server = new LiveModelServer({ count: 1 }, 1000);
    const controller = bind(contract, {
      procedures: {
        echo: (input) => ({ value: input.value }),
      },
      live: {
        models: {
          state: (key) => (key.id === 'known' ? server : null),
        },
        logs: { output: () => null },
      },
    });

    const source = controller.resolveLive(encodeTopic(contract.models.state.id, { id: 'known' }));
    expect(source?.snapshot()).toMatchObject({ data: { count: 1 } });
    expect(
      controller.resolveLive(encodeTopic(contract.models.state.id, { id: 'missing' }))?.snapshot
    ).toThrow(/Unknown live topic/);
  });

  it('roundtrips topic encoding including undefined keys', () => {
    expect(splitTopic(encodeTopic('global.model', undefined))).toEqual({
      refId: 'global.model',
      rawKey: undefined,
    });
    expect(splitTopic(encodeTopic('keyed.model', { b: 2, a: 1 }))).toEqual({
      refId: 'keyed.model',
      rawKey: { a: 1, b: 2 },
    });
  });

  it('merges procedure namespaces and rejects duplicate live refs', async () => {
    const first = bind(makeContract('first'), {
      procedures: { echo: (input) => ({ value: `first:${input.value}` }) },
      live: { models: { state: () => null }, logs: { output: () => null } },
    });
    const second = bind(makeContract('second'), {
      procedures: { echo: (input) => ({ value: `second:${input.value}` }) },
      live: { models: { state: () => null }, logs: { output: () => null } },
    });

    const merged = mergeControllers({ first, second });
    await expect(merged.call('second.echo', { value: 'x' })).resolves.toEqual({
      value: 'second:x',
    });
    await expect(merged.call('missing.echo', { value: 'x' })).rejects.toMatchObject({
      code: 'UNKNOWN_PROCEDURE',
    } satisfies Partial<WireError>);

    expect(() => mergeControllers({ one: first, duplicate: first })).toThrow(/Live ref/);
  });
});
