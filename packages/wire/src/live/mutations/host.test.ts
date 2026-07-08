import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineLiveModelContract } from '../../api/define';
import { createLiveModelHost } from './host';

const keySchema = z.object({ workspaceId: z.string(), taskId: z.string() });
const stateSchema = z.object({ count: z.number() });

describe('createLiveModelHost', () => {
  it('creates, resolves, filters, and disposes keyed instances', () => {
    const contract = defineLiveModelContract({
      key: keySchema,
      models: { state: stateSchema },
    });
    const host = createLiveModelHost(contract);
    const firstKey = { workspaceId: 'w1', taskId: 't1' };
    const secondKey = { workspaceId: 'w1', taskId: 't2' };

    const first = host.create(firstKey, { state: { count: 1 } });
    const second = host.create(secondKey, { state: { count: 2 } });

    expect(host.get(firstKey)).toBe(first);
    expect(host.instances({ workspaceId: 'w1' }).map(([key]) => key.taskId)).toEqual(['t1', 't2']);

    first.dispose();
    expect(host.get(firstKey)).toBeUndefined();
    expect(host.get(secondKey)).toBe(second);

    host.dispose();
    expect(host.instances()).toEqual([]);
  });

  it('rejects duplicate instance keys', () => {
    const contract = defineLiveModelContract({
      key: keySchema,
      models: { state: stateSchema },
    });
    const host = createLiveModelHost(contract);
    const key = { workspaceId: 'w1', taskId: 't1' };

    host.create(key, { state: { count: 1 } });

    expect(() => host.create(key, { state: { count: 2 } })).toThrow(/already exists/);
  });
});
