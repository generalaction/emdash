import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLiveModelHost } from '../live/mutations';
import { bindContract, encodeTopic, mergeControllers, splitTopic } from './bind';
import { defineContract, liveModel, liveState, liveLog, procedure } from './define';
import type { WireError } from './protocol';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });
const outputSchema = z.object({ value: z.string() });

function makeContract() {
  return defineContract({
    echo: procedure({ input: z.object({ value: z.string() }), output: outputSchema }),
    state: liveModel({ key: keySchema, states: { state: liveState({ data: stateSchema }) } }),
    output: liveLog({ key: keySchema }),
  });
}

describe('bindContract', () => {
  it('validates inputs and outputs according to policy', async () => {
    const contract = makeContract();
    const controller = bindContract(
      contract,
      {
        echo: (input) => ({ value: input.value.toUpperCase() }),
        state: createLiveModelHost(contract.state),
        output: () => null,
      },
      {
        validate: 'full',
      }
    );

    await expect(controller.call('echo', { value: 'ok' })).resolves.toEqual({ value: 'OK' });
    await expect(controller.call('echo', { value: 1 })).rejects.toThrow();
  });

  it('routes live topics through encoded keys', () => {
    const contract = makeContract();
    const host = createLiveModelHost(contract.state);
    host.create({ id: 'known' }, { state: { count: 1 } });
    const controller = bindContract(contract, {
      echo: (input) => ({ value: input.value }),
      state: host,
      output: () => null,
    });

    const source = controller.resolveLive(
      encodeTopic(contract.state.states.state.id, { id: 'known' })
    );
    expect(source?.snapshot()).toMatchObject({ data: { count: 1 } });
    expect(
      controller.resolveLive(encodeTopic(contract.state.states.state.id, { id: 'missing' }))
        ?.snapshot
    ).toThrow(/Unknown live topic/);
  });

  it('requires live model providers', () => {
    const contract = makeContract();
    expect(() =>
      bindContract(contract, {
        echo: (input) => ({ value: input.value }),
        output: () => null,
      })
    ).toThrow(/requires a LiveModelHost or provider/);
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
    const host = createLiveModelHost(contract.child.state);
    host.create({ id: 'known' }, { state: { count: 3 } });
    const controller = bindContract(contract, {
      child: {
        echo: (input) => ({ value: `child:${input.value}` }),
        state: host,
        output: () => null,
      },
    });

    expect(child.state.id).toBe('state');
    expect(child.state.states.state.id).toBe('state.state');
    expect(contract.child.state.id).toBe('child.state');
    expect(contract.child.state.states.state.id).toBe('child.state.state');
    expect(contract.child.output.id).toBe('child.output');
    await expect(controller.call('child.echo', { value: 'x' })).resolves.toEqual({
      value: 'child:x',
    });
    expect(
      controller
        .resolveLive(encodeTopic(contract.child.state.states.state.id, { id: 'known' }))
        ?.snapshot()
    ).toMatchObject({ data: { count: 3 } });
  });

  it('merges procedure namespaces', async () => {
    const procedureContract = defineContract({
      echo: procedure({ input: z.object({ value: z.string() }), output: outputSchema }),
    });
    const first = bindContract(procedureContract, {
      echo: (input) => ({ value: `first:${input.value}` }),
    });
    const second = bindContract(procedureContract, {
      echo: (input) => ({ value: `second:${input.value}` }),
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
      echo: (input) => ({ value: input.value }),
      state: createLiveModelHost(makeContract().state),
      output: () => null,
    });
    const second = bindContract(makeContract(), {
      echo: (input) => ({ value: input.value }),
      state: createLiveModelHost(makeContract().state),
      output: () => null,
    });

    expect(() => mergeControllers({ first, second })).toThrow(/Live ref/);
  });
});
