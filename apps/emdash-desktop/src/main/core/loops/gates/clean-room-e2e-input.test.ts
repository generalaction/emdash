import { describe, expect, it } from 'vitest';
import {
  CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT,
  type LoopSessionAttempt,
} from '@shared/core/loops/loop-state';
import {
  hasCanonicalAttemptFields,
  hasCanonicalPersistedLoopState,
  isCanonicalAbsolutePath,
  validPersistedAttemptState,
  workspacePathsOverlap,
} from './clean-room-e2e-boundary';
import type { RunCleanRoomE2EGateInput } from './clean-room-e2e-gate';
import {
  BASE_COMMIT,
  FEATURE_COMMIT,
  defaultInput,
  featureTarget,
  loopWithConfig,
  loopWithState,
} from './clean-room-e2e-gate.test-harness';
import {
  CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS,
  CLEAN_ROOM_E2E_MAX_ATTEMPTS,
  e2eCriteriaSchema,
  safeNormalizeInput,
} from './clean-room-e2e-input';

function historicalAttempts(count: number): LoopSessionAttempt[] {
  return Array.from({ length: count }, (_, index) => ({
    attemptId: `historical-attempt-${index}`,
    conversationId: `historical-conversation-${index}`,
    purpose: 'work',
    phaseId: `historical-phase-${index}`,
    target: featureTarget,
    status: 'completed',
    checkpointBefore: BASE_COMMIT,
    checkpointAfter: FEATURE_COMMIT,
    startedAt: '2026-07-12T00:00:00.000Z',
    finishedAt: '2026-07-12T00:00:01.000Z',
  }));
}

describe('clean-room E2E input authority', () => {
  it('accepts canonical home-directory paths while still rejecting embedded secrets', () => {
    expect(isCanonicalAbsolutePath('/home/alice/worktrees/feature')).toBe(true);
    expect(isCanonicalAbsolutePath('/Users/alice/worktrees/feature')).toBe(true);
    expect(isCanonicalAbsolutePath('C:\\Users\\alice\\worktrees\\feature')).toBe(true);
    expect(isCanonicalAbsolutePath('/home/alice/token=raw-credential')).toBe(false);
  });

  it('accepts canonical SQLite UTC metadata timestamps without relaxing durable ISO timestamps', () => {
    const sqliteTimestamp = '2026-08-02 04:35:50';
    const result = safeNormalizeInput({
      ...defaultInput,
      loop: {
        ...defaultInput.loop,
        createdAt: sqliteTimestamp,
        updatedAt: sqliteTimestamp,
      },
      phase: {
        ...defaultInput.phase,
        createdAt: sqliteTimestamp,
        updatedAt: sqliteTimestamp,
      },
    });
    const malformed = safeNormalizeInput({
      ...defaultInput,
      loop: { ...defaultInput.loop, updatedAt: '2026-08-02 4:35:50' },
    });

    expect(result.success).toBe(true);
    expect(malformed).toMatchObject({ success: false, error: { type: 'invalid-input' } });
  });

  it('accepts canonical historical v1 state only through the explicit v2 upgrade path', () => {
    if (!defaultInput.loop.state || defaultInput.loop.state.version !== '2') {
      throw new Error('Expected the current Loop state fixture.');
    }
    const {
      version: _version,
      e2eAttemptsConsumed: _e2eAttemptsConsumed,
      ...historicalState
    } = defaultInput.loop.state;

    const result = safeNormalizeInput({
      ...defaultInput,
      loop: { ...defaultInput.loop, state: { version: '1', ...historicalState } },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.loop.state).toMatchObject({ version: '2', e2eAttemptsConsumed: 0 });
  });

  it('rejects config values that parse only through normalization aliases', () => {
    const paddedModel = safeNormalizeInput({
      ...defaultInput,
      loop: loopWithConfig({ model: ' gpt-5.6-sol ' }),
    });
    const paddedCommand = safeNormalizeInput({
      ...defaultInput,
      loop: loopWithConfig({ validationCommands: [' pnpm run test ', 'pnpm run typecheck'] }),
    });

    expect(paddedModel).toMatchObject({ success: false, error: { type: 'invalid-input' } });
    expect(paddedCommand).toMatchObject({ success: false, error: { type: 'invalid-input' } });
  });

  it('uses a fixed code-owned cap and ignores a caller attempt-cap alias', () => {
    const result = safeNormalizeInput({
      ...defaultInput,
      maxAttempts: 64,
    } as RunCleanRoomE2EGateInput & { maxAttempts: number });

    expect(CLEAN_ROOM_E2E_MAX_ATTEMPTS).toBe(18);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.e2eAttemptsConsumed).toBe(0);
    expect(result.data).not.toHaveProperty('maxAttempts');
  });

  it('accepts a failed Review attempt that durably retained its correction checkpoint', () => {
    const reviewAttempt: LoopSessionAttempt = {
      attemptId: 'review-correction-attempt',
      conversationId: 'review-correction-conversation',
      purpose: 'review',
      phaseId: 'review-phase',
      target: featureTarget,
      status: 'failed',
      checkpointBefore: BASE_COMMIT,
      checkpointAfter: FEATURE_COMMIT,
      startedAt: '2026-07-12T00:00:00.000Z',
      finishedAt: '2026-07-12T00:00:01.000Z',
      error: 'Review infrastructure failed after producing a validated correction.',
    };
    const loop = loopWithState({ sessionAttempts: [reviewAttempt] });
    const result = safeNormalizeInput({
      ...defaultInput,
      loop,
    });

    expect(validPersistedAttemptState(reviewAttempt)).toBe(true);
    expect(hasCanonicalAttemptFields(reviewAttempt, reviewAttempt)).toBe(true);
    expect(hasCanonicalPersistedLoopState(loop.state)).toBe(true);
    expect(result).toMatchObject({ success: true });
  });

  it('rejects failed non-Review attempts that claim a checkpoint', () => {
    const result = safeNormalizeInput({
      ...defaultInput,
      loop: loopWithState({
        sessionAttempts: [
          {
            attemptId: 'work-failure-attempt',
            conversationId: 'work-failure-conversation',
            purpose: 'work',
            phaseId: 'work-phase',
            target: featureTarget,
            status: 'failed',
            checkpointBefore: BASE_COMMIT,
            checkpointAfter: FEATURE_COMMIT,
            startedAt: '2026-07-12T00:00:00.000Z',
            finishedAt: '2026-07-12T00:00:01.000Z',
            error: 'Work failed.',
          },
        ],
      }),
    });

    expect(result).toMatchObject({ success: false, error: { type: 'invalid-input' } });
  });

  it('reserves the bounded worst-case session records for every remaining E2E run', () => {
    const exactCapacity =
      CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS - CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT;
    const fits = safeNormalizeInput({
      ...defaultInput,
      loop: loopWithState({
        e2eAttemptsConsumed: CLEAN_ROOM_E2E_MAX_ATTEMPTS - 1,
        sessionAttempts: historicalAttempts(exactCapacity),
      }),
    });
    const overflows = safeNormalizeInput({
      ...defaultInput,
      loop: loopWithState({
        e2eAttemptsConsumed: CLEAN_ROOM_E2E_MAX_ATTEMPTS - 1,
        sessionAttempts: historicalAttempts(exactCapacity + 1),
      }),
    });

    expect(fits.success).toBe(true);
    expect(overflows).toMatchObject({ success: false, error: { type: 'invalid-input' } });
  });

  it('enforces the aggregate criteria byte cap exported to the native adapter', () => {
    const oversized = Array.from({ length: 17 }, (_, index) => ({
      description: `Criterion ${index}`,
      verifier: index === 0 ? ('agent-browser' as const) : ('unit-tests' as const),
      status: 'pending' as const,
      evidence: 'x'.repeat(16_384),
    }));

    expect(e2eCriteriaSchema.safeParse(oversized).success).toBe(false);
  });

  it.each([
    ['/feature', '/feature/nested', true],
    ['/feature/nested', '/feature', true],
    ['/feature', '/feature-sibling', false],
    ['C:\\Repo\\Feature', 'c:\\repo\\feature', true],
    ['C:\\Repo', 'c:\\repo\\feature', true],
    ['C:\\Repo\\Feature', 'D:\\Repo\\Feature', false],
    ['/feature', 'C:\\feature', true],
  ] as const)('detects machine-path overlap between %s and %s', (left, right, expectedOverlap) => {
    expect(workspacePathsOverlap(left, right)).toBe(expectedOverlap);
  });
});
