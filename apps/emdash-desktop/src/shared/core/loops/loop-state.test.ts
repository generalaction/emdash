import { describe, expect, it } from 'vitest';
import { CLEAN_ROOM_E2E_MAX_ATTEMPTS, loopStateV1Schema } from './loop-state';

const COMMIT = 'a'.repeat(40);

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1',
    baseCommit: COMMIT,
    expectedFeatureHead: COMMIT,
    checkpointCommit: COMMIT,
    sessionAttempts: [],
    verification: null,
    ...overrides,
  };
}

describe('Loop E2E attempt budget authority', () => {
  it('reads historical state without inventing persisted budget authority', () => {
    const parsed = loopStateV1Schema.parse(state());

    expect(parsed.e2eAttemptsConsumed).toBeUndefined();
    expect(parsed).not.toHaveProperty('e2eAttemptsConsumed');
  });

  it('round-trips a bounded durable consumed-attempt counter', () => {
    expect(
      loopStateV1Schema.parse(state({ e2eAttemptsConsumed: CLEAN_ROOM_E2E_MAX_ATTEMPTS }))
        .e2eAttemptsConsumed
    ).toBe(CLEAN_ROOM_E2E_MAX_ATTEMPTS);
    expect(loopStateV1Schema.safeParse(state({ e2eAttemptsConsumed: -1 })).success).toBe(false);
    expect(loopStateV1Schema.safeParse(state({ e2eAttemptsConsumed: 65 })).success).toBe(false);
  });
});
