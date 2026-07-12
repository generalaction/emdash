import { describe, expect, it } from 'vitest';
import {
  CLEAN_ROOM_E2E_MAX_ATTEMPTS,
  loopState,
  loopStateInputSchema,
  loopStateV1Schema,
  loopStateV2Schema,
} from './loop-state';

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
  it('keeps the historical v1 contract frozen without budget authority', () => {
    const parsed = loopStateV1Schema.parse(state());

    expect(parsed).not.toHaveProperty('e2eAttemptsConsumed');
    expect(
      loopStateV1Schema.safeParse(state({ e2eAttemptsConsumed: CLEAN_ROOM_E2E_MAX_ATTEMPTS }))
        .success
    ).toBe(false);
  });

  it('upgrades historical v1 reads to current v2 with a conservative zero counter', () => {
    const parsed = loopState.safeParse(state());

    expect(parsed).toEqual({
      status: 'ok',
      data: {
        ...state(),
        version: '2',
        e2eAttemptsConsumed: 0,
      },
    });
    expect(loopStateInputSchema.parse(state())).toEqual(
      expect.objectContaining({ version: '2', e2eAttemptsConsumed: 0 })
    );
  });

  it('round-trips only a bounded current-v2 durable consumed-attempt counter', () => {
    const current = {
      ...state(),
      version: '2',
      e2eAttemptsConsumed: CLEAN_ROOM_E2E_MAX_ATTEMPTS,
    };
    expect(loopStateV2Schema.parse(current).e2eAttemptsConsumed).toBe(CLEAN_ROOM_E2E_MAX_ATTEMPTS);
    expect(loopStateV2Schema.safeParse({ ...current, e2eAttemptsConsumed: -1 }).success).toBe(
      false
    );
    expect(
      loopStateV2Schema.safeParse({
        ...current,
        e2eAttemptsConsumed: CLEAN_ROOM_E2E_MAX_ATTEMPTS + 1,
      }).success
    ).toBe(false);
    expect(loopState.parseJson(loopState.serialize(loopStateV2Schema.parse(current)))).toEqual(
      current
    );
  });
});
