import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { admit, admitBatch } from './admission';
import { defineConflictPolicy } from './conflict-policy';
import { defineOperation, type AnyOperationDefinition } from './definition';
import type { OperationRecord } from './record';
import type { ResourceClaim } from './resources';

const schema = defineVersionedSchema()
  .initial('1', z.object({ key: z.string() }))
  .build();

const exclusive = (key: string): ResourceClaim => ({
  resource: 'resource',
  key,
  mode: 'exclusive',
  implicit: false,
});

const shared = (key: string): ResourceClaim => ({
  resource: 'resource',
  key,
  mode: 'shared',
  implicit: false,
});

function op(
  name: string,
  claim: (input: { key: string }) => ResourceClaim[]
): AnyOperationDefinition {
  return defineOperation({
    name,
    input: schema,
    result: z.object({ ok: z.boolean() }),
    error: z.object({ code: z.string() }),
    key: (input) => `${name}:${input.key}`,
    claims: claim,
  });
}

function record(
  id: string,
  definition: AnyOperationDefinition,
  key: string,
  claims: ResourceClaim[],
  parentId?: string
): OperationRecord {
  return {
    id,
    seq: Number(id.replace(/\D/g, '')) || 1,
    name: definition.name,
    key,
    input: { key },
    claims,
    status: 'pending',
    attempt: 0,
    parentId,
    initiator: { kind: 'user', action: 'test' },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('admit', () => {
  test('dedupes by key before consulting conflicts', () => {
    const incoming = op('incoming', () => [exclusive('a')]);
    const existing = record('op1', incoming, 'same-key', [exclusive('a')]);
    const policy = defineConflictPolicy((on) => {
      on(incoming, incoming).reject();
    });

    expect(
      admit(
        { definition: incoming, key: 'same-key', claims: [exclusive('a')] },
        [existing],
        policy,
        () => undefined
      )
    ).toEqual({ kind: 'dedupe', existing });
  });

  test('rejects same-key operations with different definitions', () => {
    const incoming = op('incoming', () => [exclusive('a')]);
    const existingDef = op('existing', () => [exclusive('a')]);
    const existing = record('op1', existingDef, 'same-key', [exclusive('a')]);

    expect(
      admit(
        { definition: incoming, key: 'same-key', claims: [exclusive('a')] },
        [existing],
        defineConflictPolicy(() => {}),
        () => undefined
      )
    ).toEqual({ kind: 'reject', conflicts: [existing] });
  });

  test('collects supersede targets but rejects if any collision rejects', () => {
    const incoming = op('incoming', () => [exclusive('a'), exclusive('b')]);
    const supersededDef = op('superseded', () => [exclusive('a')]);
    const rejectedDef = op('rejected', () => [exclusive('b')]);
    const superseded = record('op1', supersededDef, 'superseded:a', [exclusive('a')]);
    const rejected = record('op2', rejectedDef, 'rejected:b', [exclusive('b')]);
    const policy = defineConflictPolicy((on) => {
      on(incoming, supersededDef).supersede();
      on(incoming, rejectedDef).reject();
    });

    expect(
      admit(
        { definition: incoming, key: 'incoming:a', claims: [exclusive('a'), exclusive('b')] },
        [superseded, rejected],
        policy,
        () => undefined
      )
    ).toEqual({ kind: 'reject', conflicts: [rejected] });
  });

  test('queue collisions contribute nothing beyond insertion', () => {
    const incoming = op('incoming', () => [exclusive('a')]);
    const existingDef = op('existing', () => [shared('a')]);
    const existing = record('op1', existingDef, 'existing:a', [shared('a')]);
    const policy = defineConflictPolicy((on) => {
      on(incoming, existingDef).queue();
    });

    expect(
      admit(
        { definition: incoming, key: 'incoming:a', claims: [exclusive('a')] },
        [existing],
        policy,
        () => undefined
      )
    ).toEqual({ kind: 'insert', toSupersede: [] });
  });

  test('exempts ancestor chains from conflict checks', () => {
    const parentDef = op('parent', () => [exclusive('a')]);
    const childDef = op('child', () => [exclusive('a')]);
    const parent = record('op1', parentDef, 'parent:a', [exclusive('a')]);
    const policy = defineConflictPolicy(() => {});

    expect(
      admit(
        { definition: childDef, key: 'child:a', claims: [exclusive('a')], parentId: parent.id },
        [parent],
        policy,
        (id) => (id === parent.id ? parent : undefined)
      )
    ).toEqual({ kind: 'insert', toSupersede: [] });
  });
});

describe('admitBatch', () => {
  test('dedupes later members onto earlier placeholders by index', () => {
    const childDef = op('child', (input) => [exclusive(input.key)]);

    const decision = admitBatch(
      [
        { definition: childDef, input: { key: 'a' } },
        { definition: childDef, input: { key: 'a' } },
      ],
      [],
      defineConflictPolicy(() => {})
    );

    expect(decision.kind).toBe('insert');
    if (decision.kind === 'insert') {
      expect(decision.members[1]?.dedupeOfIndex).toBe(0);
      expect(decision.members[1]?.adopted).toBeUndefined();
    }
  });

  test('rejects forward parent references', () => {
    const childDef = op('child', (input) => [exclusive(input.key)]);

    expect(() =>
      admitBatch(
        [
          { definition: childDef, input: { key: 'a' }, parent: 1 },
          { definition: childDef, input: { key: 'b' } },
        ],
        [],
        defineConflictPolicy(() => {})
      )
    ).toThrow(/parents must appear earlier/);
  });

  test('adopts matching orphan operations only', () => {
    const parentDef = op('parent', () => [exclusive('parent')]);
    const childDef = op('child', (input) => [exclusive(input.key)]);
    const orphan = record('op1', childDef, 'child:a', [exclusive('a')]);
    const parented = record('op2', childDef, 'child:b', [exclusive('b')], 'other-parent');

    const decision = admitBatch(
      [
        { definition: parentDef, input: { key: 'parent' } },
        { definition: childDef, input: { key: 'a' }, parent: 0, adoptExisting: true },
        { definition: childDef, input: { key: 'b' }, parent: 0, adoptExisting: true },
      ],
      [orphan, parented],
      defineConflictPolicy(() => {})
    );

    expect(decision.kind).toBe('insert');
    if (decision.kind === 'insert') {
      expect(decision.reparent).toEqual([{ id: orphan.id, parentIndex: 0 }]);
      expect(decision.members[1]?.adopted).toBe(orphan);
      expect(decision.members[2]?.adopted).toBe(parented);
    }
  });

  test('exempts planned adoptions from ancestor conflicts', () => {
    const parentDef = op('parent', () => [exclusive('a')]);
    const childDef = op('child', () => [exclusive('a')]);
    const orphan = record('op1', childDef, 'child:a', [exclusive('a')]);

    const decision = admitBatch(
      [
        { definition: parentDef, input: { key: 'a' } },
        { definition: childDef, input: { key: 'a' }, parent: 0, adoptExisting: true },
      ],
      [orphan],
      defineConflictPolicy(() => {})
    );

    expect(decision.kind).toBe('insert');
    if (decision.kind === 'insert') {
      expect(decision.reparent).toEqual([{ id: orphan.id, parentIndex: 0 }]);
    }
  });
});
