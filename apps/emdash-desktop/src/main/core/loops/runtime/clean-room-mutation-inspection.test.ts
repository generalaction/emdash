import { describe, expect, it } from 'vitest';
import { deriveCleanRoomMutationInspection } from './clean-room-mutation-inspection';

describe('clean-room mutation inspection', () => {
  it('retains the attempt baseline while reporting a later mutation', () => {
    const beginning = deriveCleanRoomMutationInspection('a'.repeat(40), '', 'feature\n');
    const inspected = deriveCleanRoomMutationInspection(
      'b'.repeat(40),
      '',
      'feature\n',
      beginning.mutationBaseline
    );

    expect(beginning.mutated).toBe(false);
    expect(inspected).toEqual({
      mutationBaseline: beginning.mutationBaseline,
      mutated: true,
    });
  });

  it('retains the attempt baseline when the workspace is unchanged', () => {
    const beginning = deriveCleanRoomMutationInspection('a'.repeat(40), '', 'feature\n');

    expect(
      deriveCleanRoomMutationInspection('a'.repeat(40), '', 'feature\n', beginning.mutationBaseline)
    ).toEqual({
      mutationBaseline: beginning.mutationBaseline,
      mutated: false,
    });
  });
});
