import { defineOperation } from '@emdash/core/primitives/kernel/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import z from 'zod';
import { operationErrorSchema, operationResultSchema } from '../../node';
import {
  enqueueTombstoned,
  type OperationSubmitter,
  type TombstoneEnqueueSpec,
} from './enqueue-tombstoned';

const inputSchema = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), id: z.string() }))
  .build();
const operation = defineOperation({
  name: 'test-tombstone',
  input: inputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => input.id,
  claims: () => [],
  retry: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 1 } },
});

describe('enqueueTombstoned', () => {
  it('orders load, input compilation, tombstone, submission, and pokes', async () => {
    const calls: string[] = [];
    const submitter = fakeSubmitter(async () => {
      calls.push('submit');
      return ok({ operationId: 'operation-1' });
    });

    const result = await enqueueTombstoned(submitter, spec(calls));

    expect(result).toEqual(ok({ operationId: 'operation-1' }));
    expect(calls).toEqual(['load', 'build-input', 'precondition', 'tombstone', 'submit', 'poke']);
  });

  it('reverts the tombstone when submission fails', async () => {
    const calls: string[] = [];
    const submitter = fakeSubmitter(async () => {
      calls.push('submit');
      return err({ type: 'operation-conflict', message: 'busy' });
    });

    const result = await enqueueTombstoned(submitter, spec(calls));

    expect(result.success).toBe(false);
    expect(calls).toEqual(['load', 'build-input', 'precondition', 'tombstone', 'submit', 'revert']);
  });

  it('short-circuits when the precondition fails', async () => {
    const calls: string[] = [];
    const submitter = fakeSubmitter(vi.fn(async () => ok({ operationId: 'never' })));
    const enqueueSpec = spec(calls);
    enqueueSpec.precondition = () => {
      calls.push('precondition');
      return { type: 'operation-conflict', message: 'blocked' };
    };

    const result = await enqueueTombstoned(submitter, enqueueSpec);

    expect(result).toEqual(err({ type: 'operation-conflict', message: 'blocked' }));
    expect(calls).toEqual(['load', 'build-input', 'precondition']);
    expect(submitter.submit).not.toHaveBeenCalled();
  });
});

function spec(calls: string[]): TombstoneEnqueueSpec<{ id: string }, typeof operation> {
  return {
    definition: operation,
    load: () => {
      calls.push('load');
      return { id: 'entity-1' };
    },
    notFound: () => ({ type: 'operation-not-found', message: 'missing' }),
    buildInput: (row) => {
      calls.push('build-input');
      return { version: '1', id: row.id };
    },
    precondition: () => {
      calls.push('precondition');
      return undefined;
    },
    tombstone: () => {
      calls.push('tombstone');
      return 1;
    },
    revert: () => {
      calls.push('revert');
    },
    poke: () => {
      calls.push('poke');
    },
  };
}

function fakeSubmitter(submit: OperationSubmitter['submit']): OperationSubmitter {
  return {
    db: {
      transaction: (run: (tx: unknown) => unknown) => run({}),
    } as never,
    submit: vi.fn(submit),
  };
}
