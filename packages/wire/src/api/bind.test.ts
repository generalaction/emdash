import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModelServer } from '../live/model';
import { LiveModelRegistry } from '../live/mutations';
import { bindContract, encodeTopic, fromRegistry, mergeControllers, splitTopic } from './bind';
import { defineContract, liveLog, liveModel, procedure } from './define';
import type { WireError } from './protocol';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });
const outputSchema = z.object({ value: z.string() });

function makeContract() {
  return defineContract({
    echo: procedure({ input: z.object({ value: z.string() }), output: outputSchema }),
    state: liveModel({ key: keySchema, data: stateSchema }),
    output: liveLog({ key: keySchema }),
  });
}

describe('bindContract', () => {
  it('validates inputs and outputs according to policy', async () => {
    const contract = makeContract();
    const controller = bindContract(contract, {
      impl: {
        echo: (input) => ({ value: input.value.toUpperCase() }),
        state: () => null,
        output: () => null,
      },
      validate: 'full',
    });

    await expect(controller.call('echo', { value: 'ok' })).resolves.toEqual({ value: 'OK' });
    await expect(controller.call('echo', { value: 1 })).rejects.toThrow();
  });

  it('routes live topics through encoded keys', () => {
    const contract = makeContract();
    const server = new LiveModelServer({ count: 1 }, 1000);
    const controller = bindContract(contract, {
      impl: {
        echo: (input) => ({ value: input.value }),
        state: (key) => (key.id === 'known' ? server : null),
        output: () => null,
      },
    });

    const source = controller.resolveLive(encodeTopic(contract.state.id, { id: 'known' }));
    expect(source?.snapshot()).toMatchObject({ data: { count: 1 } });
    expect(
      controller.resolveLive(encodeTopic(contract.state.id, { id: 'missing' }))?.snapshot
    ).toThrow(/Unknown live topic/);
  });

  it('can resolve live models from the registry', () => {
    const contract = makeContract();
    const registry = new LiveModelRegistry();
    const server = new LiveModelServer({ count: 2 }, 1000);
    registry.register(contract.state, { id: 'known' }, server);
    const controller = bindContract(contract, {
      registry,
      impl: {
        echo: (input) => ({ value: input.value }),
        state: fromRegistry(),
        output: () => null,
      },
    });

    expect(
      controller.resolveLive(encodeTopic(contract.state.id, { id: 'known' }))?.snapshot()
    ).toMatchObject({
      data: { count: 2 },
    });
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

  it('binds nested contracts using object keys as paths', async () => {
    const child = makeContract();
    const contract = defineContract({ child });
    const server = new LiveModelServer({ count: 3 }, 1000);
    const controller = bindContract(contract, {
      impl: {
        child: {
          echo: (input) => ({ value: `child:${input.value}` }),
          state: (key) => (key.id === 'known' ? server : null),
          output: () => null,
        },
      },
    });

    expect(child.state.id).toBe('state');
    expect(contract.child.state.id).toBe('child.state');
    expect(contract.child.output.id).toBe('child.output');
    await expect(controller.call('child.echo', { value: 'x' })).resolves.toEqual({
      value: 'child:x',
    });
    expect(
      controller.resolveLive(encodeTopic(contract.child.state.id, { id: 'known' }))?.snapshot()
    ).toMatchObject({ data: { count: 3 } });
  });

  it('merges procedure namespaces', async () => {
    const procedureContract = defineContract({
      echo: procedure({ input: z.object({ value: z.string() }), output: outputSchema }),
    });
    const first = bindContract(procedureContract, {
      impl: {
        echo: (input) => ({ value: `first:${input.value}` }),
      },
    });
    const second = bindContract(procedureContract, {
      impl: {
        echo: (input) => ({ value: `second:${input.value}` }),
      },
    });

    const merged = mergeControllers({ first, second });
    await expect(merged.call('second.echo', { value: 'x' })).resolves.toEqual({
      value: 'second:x',
    });
    await expect(merged.call('missing.echo', { value: 'x' })).rejects.toMatchObject({
      code: 'UNKNOWN_PROCEDURE',
    } satisfies Partial<WireError>);
  });

  it('rejects duplicate live refs when merging controllers', () => {
    const first = bindContract(makeContract(), {
      impl: {
        echo: (input) => ({ value: input.value }),
        state: () => null,
        output: () => null,
      },
    });
    const second = bindContract(makeContract(), {
      impl: {
        echo: (input) => ({ value: input.value }),
        state: () => null,
        output: () => null,
      },
    });

    expect(() => mergeControllers({ first, second })).toThrow(/Live ref/);
  });
});
