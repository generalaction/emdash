import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineConflictPolicy } from '../api/conflict-policy';
import { defineOperation } from '../api/definition';
import { lintConflictPolicyCompleteness } from './completeness-lint';

const schema = defineVersionedSchema()
  .initial('1', z.object({ key: z.string() }))
  .build();

const first = defineOperation({
  name: 'first',
  input: schema,
  result: z.object({ ok: z.boolean() }),
  error: z.object({ code: z.string() }),
  key: (input) => `first:${input.key}`,
  claims: (input) => [{ resource: 'resource', key: input.key, mode: 'exclusive', implicit: false }],
});

const second = defineOperation({
  name: 'second',
  input: schema,
  result: z.object({ ok: z.boolean() }),
  error: z.object({ code: z.string() }),
  key: (input) => `second:${input.key}`,
  claims: (input) => [{ resource: 'resource', key: input.key, mode: 'shared', implicit: false }],
});

describe('lintConflictPolicyCompleteness', () => {
  test('reports colliding definition pairs without explicit rows', () => {
    expect(
      lintConflictPolicyCompleteness(
        [
          { definition: first, input: { key: 'a' } },
          { definition: second, input: { key: 'a' } },
        ],
        defineConflictPolicy(() => {})
      )
    ).toEqual([
      { incoming: 'first', existing: 'second', reason: 'missing-conflict-policy' },
      { incoming: 'second', existing: 'first', reason: 'missing-conflict-policy' },
    ]);
  });

  test('treats explicit reject rows as complete', () => {
    const policy = defineConflictPolicy((on) => {
      on(first, second).reject();
      on(second, first).reject();
    });

    expect(
      lintConflictPolicyCompleteness(
        [
          { definition: first, input: { key: 'a' } },
          { definition: second, input: { key: 'a' } },
        ],
        policy
      )
    ).toEqual([]);
  });
});
