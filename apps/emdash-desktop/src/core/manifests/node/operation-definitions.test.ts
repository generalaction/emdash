import { lintConflictPolicyCompleteness } from '@emdash/core/primitives/kernel/testing';
import { describe, expect, test } from 'vitest';
import { createOperationDefinitions } from './operation-definitions';

describe('desktop operation conflict policy', () => {
  test('has an explicit policy for every descriptor example collision', () => {
    const created = createOperationDefinitions({
      db: {} as never,
      deleteAutomation: {} as never,
      deleteConversation: {} as never,
      deleteProject: {} as never,
      deleteTask: {} as never,
      hostOutbox: {} as never,
    });
    const samples = created.definitions.flatMap((descriptor) => descriptor.examples);

    expect(lintConflictPolicyCompleteness(samples, created.conflictPolicies[0]!)).toEqual([]);
  });
});
