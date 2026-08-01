import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineOperation } from './definition';

const input = defineVersionedSchema()
  .initial('1', z.object({ id: z.string() }))
  .build();

describe('defineOperation', () => {
  test('returns a frozen typed definition', () => {
    const operation = defineOperation({
      name: 'scan',
      input,
      result: z.object({ ok: z.boolean() }),
      error: z.object({ code: z.string() }),
      key: (value) => `scan:${value.id}`,
      claims: () => [],
      describe: (value) => `Scan ${value.id}`,
    });

    expect(Object.isFrozen(operation)).toBe(true);
    expect(operation.name).toBe('scan');
    expect(operation.key({ id: 'a' })).toBe('scan:a');
    expect(operation.describe?.({ id: 'a' })).toBe('Scan a');
  });
});
