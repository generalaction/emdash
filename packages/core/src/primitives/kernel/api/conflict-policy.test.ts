import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineConflictPolicy, mergeConflictPolicies } from './conflict-policy';
import { defineOperation, type AnyOperationDefinition } from './definition';

const schema = defineVersionedSchema()
  .initial('1', z.object({ id: z.string() }))
  .build();

function op(name: string): AnyOperationDefinition {
  return defineOperation({
    name,
    input: schema,
    result: z.object({ ok: z.boolean() }),
    error: z.object({ code: z.string() }),
    key: (input) => `${name}:${input.id}`,
    claims: () => [],
  });
}

describe('defineConflictPolicy', () => {
  test('resolves directional rows and defaults to reject', () => {
    const incoming = op('incoming');
    const existing = op('existing');
    const reverse = op('reverse');

    const policy = defineConflictPolicy((on) => {
      on(incoming, existing).queue();
      on(existing, incoming).supersede();
    });

    expect(policy.resolve(incoming, existing)).toBe('queue');
    expect(policy.resolve(existing, incoming)).toBe('supersede');
    expect(policy.resolve(incoming, reverse)).toBe('reject');
  });

  test('throws on duplicate rows in one policy', () => {
    const incoming = op('incoming');
    const existing = op('existing');

    expect(() =>
      defineConflictPolicy((on) => {
        on(incoming, existing).queue();
        on(incoming, existing).reject();
      })
    ).toThrow(/Duplicate conflict policy/);
  });

  test('throws on duplicate rows while merging policies', () => {
    const incoming = op('incoming');
    const existing = op('existing');

    const first = defineConflictPolicy((on) => {
      on(incoming, existing).queue();
    });
    const second = defineConflictPolicy((on) => {
      on(incoming, existing).reject();
    });

    expect(() => mergeConflictPolicies([first, second])).toThrow(/Duplicate conflict policy/);
  });
});
