import { describe, expect, it, vi } from 'vitest';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { err, ok } from '@main/lib/result';
import { CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT } from '@shared/core/loops/loop-state';
import type { LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { CleanRoomProject } from '../clean-room/clean-room-workspace-service';
import type { CleanRoomE2EGateDependencies, RunCleanRoomE2EGateInput } from './clean-room-e2e-gate';
import {
  E2E_CRITERIA,
  FEATURE_COMMIT,
  FIX_COMMIT,
  arrangeWhitespaceTargetEcho,
  cleanTargetFor,
  defaultInput,
  featureTarget,
  historicalAttempts,
  historicalE2EAttempt,
  loop,
  loopWithState,
  makeHarness,
  nestedAttempt,
  phase,
  project,
  prerequisitePhases,
  sshFeatureTarget,
  type Harness,
  type TargetEchoPort,
} from './clean-room-e2e-gate.test-harness';
import { reduceE2EProgress, type E2EDurableProgress } from './clean-room-e2e-progress';

describe('CleanRoomE2EGate hardening', () => {
  it.each([
    [
      'an already-aborted signal',
      () => {
        const controller = new AbortController();
        controller.abort();
        return { signal: controller.signal };
      },
      'cancelled',
    ],
    ['an already-expired deadline', () => ({ deadlineAt: Date.now() - 1 }), 'deadline-exceeded'],
  ] as const)(
    'rejects %s before prerequisite or project dependency calls',
    async (_name, makeControl, expectedType) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      const getDefaultBranch = vi.fn(async () => 'main');

      const result = await harness.gate.run({
        ...defaultInput,
        ...makeControl(),
        project: {
          ...project,
          settings: { getDefaultBranch } as unknown as CleanRoomProject['settings'],
        },
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: expectedType, stage: 'precondition', attempt: 0 },
      });
      expect(harness.dependencies.prerequisites.resolve).not.toHaveBeenCalled();
      expect(getDefaultBranch).not.toHaveBeenCalled();
      expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['fabricated omission', () => []],
    [
      'stale Review checkpoint',
      () => {
        const phases = prerequisitePhases(true);
        return phases.map((prior, index) =>
          index === phases.length - 1
            ? {
                ...prior,
                state: {
                  ...prior.state!,
                  checkpointCommit: '1'.repeat(40),
                },
              }
            : prior
        );
      },
    ],
  ] as const)('rejects %s in durable prerequisites before any effect', async (_name, phases) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.prerequisites.resolve).mockResolvedValueOnce(
      ok({ phases: phases() as never })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: expect.stringMatching(/^prerequisite-/), stage: 'precondition' },
    });
    expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('contains a throwing raw checkpoint getter without rereading invalid input', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const hostileInput = Object.defineProperty({ ...defaultInput }, 'checkpointCommit', {
      enumerable: true,
      get: () => {
        throw new Error('hostile checkpoint getter');
      },
    }) as RunCleanRoomE2EGateInput;

    await expect(harness.gate.run(hostileInput)).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('snapshots a stateful task getter once and still cleans every acquired resource', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    let nameReads = 0;
    const statefulTask = Object.defineProperty({ id: loop.taskId }, 'name', {
      enumerable: true,
      get: () => {
        nameReads += 1;
        if (nameReads === 1) return 'Loop task';
        throw new Error('task name changed after normalization');
      },
    }) as { id: string; name: string };

    const result = await harness.gate.run({ ...defaultInput, task: statefulTask });

    expect(result).toMatchObject({
      success: true,
      data: { lastWorkspaceDestroyed: true },
    });
    expect(nameReads).toBe(1);
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('retains and cancels readable actual session IDs when an unrelated success getter throws', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockImplementationOnce(
      async (input) => {
        const actual = {
          ...input,
          attemptId: 'actual-hostile-attempt',
          conversationId: 'actual-hostile-conversation',
        };
        Object.defineProperty(actual, 'unrelated', {
          enumerable: true,
          get: () => {
            throw new Error('hostile unrelated getter');
          },
        });
        return ok(actual);
      }
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'actual-hostile-attempt',
            status: 'cancelled',
          }),
        ]),
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'actual-hostile-attempt',
        conversationId: 'actual-hostile-conversation',
      })
    );
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'cyclic',
      () => {
        const sessionAttempts: unknown[] = [];
        sessionAttempts.push(sessionAttempts);
        return { message: 'Session start rejected.', quiescent: true, sessionAttempts };
      },
    ],
    [
      'oversized',
      () => ({
        message: 'Session start rejected.',
        quiescent: true,
        sessionAttempts: ['x'.repeat(2 * 1024 * 1024)],
      }),
    ],
    [
      'hostile',
      () =>
        Object.defineProperty(
          { message: 'Session start rejected.', quiescent: true },
          'sessionAttempts',
          {
            enumerable: true,
            get: () => {
              throw new Error('hostile reported session ledger');
            },
          }
        ),
    ],
  ] as const)(
    'retains the workspace when a start error supplies an unserializable %s session ledger',
    async (_name, error) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      vi.mocked(harness.dependencies.session.startFreshE2ESession).mockResolvedValueOnce(
        err(error() as never)
      );

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'cleanup-failed',
          stage: 'quiescence',
          recoveryRequired: true,
          lastWorkspaceDestroyed: false,
        },
      });
      expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
      expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'array method',
      () =>
        new Proxy([] as unknown[], {
          get(target, property, receiver) {
            if (property === 'slice') throw new Error('hostile session-attempt array');
            return Reflect.get(target, property, receiver);
          },
        }),
    ],
    [
      'candidate field',
      () => [
        Object.defineProperty({}, 'attemptId', {
          enumerable: true,
          get: () => {
            throw new Error('hostile nested attempt field');
          },
        }),
      ],
    ],
  ] as const)(
    'contains a hostile required-check error %s and still cleans the workspace',
    async (_name, sessionAttempts) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      vi.mocked(harness.dependencies.requiredChecks.run).mockResolvedValueOnce(
        err({
          message: 'Required checks rejected.',
          quiescent: true,
          sessionAttempts: sessionAttempts(),
        })
      );

      await expect(harness.gate.run(defaultInput)).resolves.toMatchObject({
        success: false,
        error: { type: 'dependency-rejected', stage: 'required-checks' },
      });
      expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    }
  );

  it('write-ahead ledgers a distinct nested actual and retains the workspace when quiescence is false', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.requiredChecks.run).mockImplementationOnce(async (input) =>
      err({
        message: 'Nested cancellation was not acknowledged.',
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: [
          nestedAttempt({
            ...input.sessionIdentity,
            status: 'interrupted',
            checkpointAfter: undefined,
            error: 'Expected nested identity was interrupted.',
          }),
          nestedAttempt({
            attemptId: 'actual-nested-attempt',
            conversationId: 'actual-nested-conversation',
            status: 'interrupted',
            checkpointAfter: undefined,
            error: 'Actual nested identity remains unquiesced.',
          }),
        ],
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({ attemptId: 'actual-nested-attempt', status: 'interrupted' }),
        ]),
      },
    });
    const actualTransitions = vi
      .mocked(harness.dependencies.progress.commit)
      .mock.calls.map(([call]) => call.transition)
      .filter(
        (transition) =>
          transition.kind === 'session-attempts' &&
          transition.next.some((attempt) => attempt.attemptId === 'actual-nested-attempt')
      );
    expect(actualTransitions).toEqual([
      expect.objectContaining({
        next: expect.arrayContaining([
          expect.objectContaining({ attemptId: 'actual-nested-attempt', status: 'starting' }),
        ]),
      }),
      expect.objectContaining({
        next: expect.arrayContaining([
          expect.objectContaining({ attemptId: 'actual-nested-attempt', status: 'interrupted' }),
        ]),
      }),
    ]);
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an explicit error',
      (harness: Harness) =>
        vi
          .mocked(harness.dependencies.session.startFreshE2ESession)
          .mockResolvedValueOnce(err({ message: 'start may have created the session' })),
    ],
    [
      'a malformed settlement',
      (harness: Harness) =>
        vi
          .mocked(harness.dependencies.session.startFreshE2ESession)
          .mockResolvedValueOnce({} as never),
    ],
  ] as const)(
    'cancels the exact preallocated identity when session start returns %s',
    async (_name, arrange) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      arrange(harness);

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: { stage: 'session-start', lastWorkspaceDestroyed: true },
      });
      expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId: 'e2e-attempt-1',
          conversationId: 'e2e-conversation-1',
          phaseId: phase.id,
          verificationRunId: 'verification-run-1',
        })
      );
      expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    }
  );

  it('durably records a distinct actual identity from a stopped late session start', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type StartResult = Awaited<
      ReturnType<CleanRoomE2EGateDependencies['session']['startFreshE2ESession']>
    >;
    const deferred = Promise.withResolvers<StartResult>();
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockReturnValueOnce(
      deferred.promise
    );

    const run = harness.gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(harness.dependencies.session.startFreshE2ESession).toHaveBeenCalledOnce()
    );
    const started = vi.mocked(harness.dependencies.session.startFreshE2ESession).mock.calls[0]![0];
    controller.abort();
    deferred.resolve(
      ok({
        attemptId: 'late-actual-attempt',
        conversationId: 'late-actual-conversation',
        purpose: 'e2e',
        phaseId: started.phaseId,
        verificationRunId: started.verificationRunId,
        attempt: started.attempt,
        target: started.target,
        provider: started.provider,
        model: started.model,
        taskEnvironment: started.taskEnvironment,
      })
    );
    const result = await run;

    expect(result).toMatchObject({ success: false, error: { type: 'cancelled' } });
    if (result.success) throw new Error('Expected a cancelled run.');
    expect(result.error.sessionAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptId: 'e2e-attempt-1',
          conversationId: 'e2e-conversation-1',
          status: 'cancelled',
        }),
        expect.objectContaining({
          attemptId: 'late-actual-attempt',
          conversationId: 'late-actual-conversation',
          status: 'cancelled',
        }),
      ])
    );
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledTimes(2);
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each(['attempt', 'conversation'] as const)(
    'retains recovery authority when an actual outer identity partially collides by %s ID',
    async (collision) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
      const originalStart = start.getMockImplementation()!;
      start.mockImplementationOnce(async (input) => {
        const started = await originalStart(input);
        if (!started.success) return started;
        return ok({
          ...started.data,
          attemptId:
            collision === 'attempt' ? input.attemptId : 'partially-colliding-actual-attempt',
          conversationId:
            collision === 'conversation'
              ? input.conversationId
              : 'partially-colliding-actual-conversation',
        });
      });

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: {
          stage: 'quiescence',
          recoveryRequired: true,
          lastWorkspaceDestroyed: false,
          pendingWorkspace: { cleanupId: 'cleanup-loop-verify-1' },
        },
      });
      expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId:
            collision === 'attempt' ? 'e2e-attempt-1' : 'partially-colliding-actual-attempt',
          conversationId:
            collision === 'conversation'
              ? 'e2e-conversation-1'
              : 'partially-colliding-actual-conversation',
        })
      );
      expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    }
  );

  it('attempts every known cancellation after the first identity fails to quiesce', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type StartResult = Awaited<
      ReturnType<CleanRoomE2EGateDependencies['session']['startFreshE2ESession']>
    >;
    const deferred = Promise.withResolvers<StartResult>();
    const firstCancellation =
      Promise.withResolvers<
        Awaited<ReturnType<CleanRoomE2EGateDependencies['session']['cancelE2ESession']>>
      >();
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockReturnValueOnce(
      deferred.promise
    );
    vi.mocked(harness.dependencies.session.cancelE2ESession)
      .mockReturnValueOnce(firstCancellation.promise)
      .mockImplementationOnce(async (input) => ok({ ...input, quiescent: true as const }));

    const run = harness.gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(harness.dependencies.session.startFreshE2ESession).toHaveBeenCalledOnce()
    );
    const started = vi.mocked(harness.dependencies.session.startFreshE2ESession).mock.calls[0]![0];
    controller.abort();
    deferred.resolve(
      ok({
        ...started,
        attemptId: 'late-actual-after-failure',
        conversationId: 'late-conversation-after-failure',
      })
    );

    await vi.waitFor(() =>
      expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledTimes(2)
    );
    firstCancellation.resolve(err({ message: 'expected identity cancellation failed' }));

    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: { stage: 'quiescence', recoveryRequired: true, lastWorkspaceDestroyed: false },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledTimes(2);
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenLastCalledWith(
      expect.objectContaining({ attemptId: 'late-actual-after-failure' })
    );
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('write-ahead records and concurrently cancels every reported start-failure identity', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const cancel = vi.mocked(harness.dependencies.session.cancelE2ESession);
    const originalCancel = cancel.getMockImplementation()!;
    const firstCancellation =
      Promise.withResolvers<
        Awaited<ReturnType<CleanRoomE2EGateDependencies['session']['cancelE2ESession']>>
      >();
    cancel.mockReturnValueOnce(firstCancellation.promise).mockImplementation(originalCancel);
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockImplementationOnce(
      async (input) =>
        err({
          message: 'Start returned multiple live identities.',
          quiescent: false,
          recoveryRequired: true,
          sessionAttempts: [
            {
              attemptId: 'reported-actual-attempt-1',
              conversationId: 'reported-actual-conversation-1',
              purpose: 'e2e',
              phaseId: input.phaseId,
              verificationRunId: input.verificationRunId,
              target: input.target,
              status: 'running',
              checkpointBefore: FEATURE_COMMIT,
              startedAt: '2026-07-12T01:02:02.000Z',
            },
            {
              attemptId: 'reported-actual-attempt-2',
              conversationId: 'reported-actual-conversation-2',
              purpose: 'e2e',
              phaseId: input.phaseId,
              verificationRunId: input.verificationRunId,
              target: input.target,
              status: 'starting',
              checkpointBefore: FEATURE_COMMIT,
              startedAt: '2026-07-12T01:02:02.500Z',
            },
          ],
        })
    );

    const run = harness.gate.run(defaultInput);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(3));
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    const writeAheadIds = vi
      .mocked(harness.dependencies.progress.commit)
      .mock.calls.flatMap(([call]) =>
        call.transition.kind === 'session-attempts'
          ? call.transition.next
              .filter((attempt) => attempt.status === 'starting')
              .map((attempt) => attempt.attemptId)
          : []
      );
    expect(writeAheadIds).toEqual(
      expect.arrayContaining(['reported-actual-attempt-1', 'reported-actual-attempt-2'])
    );
    const firstInput = cancel.mock.calls[0]![0];
    firstCancellation.resolve(ok({ ...firstInput, quiescent: true }));
    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'reported-actual-attempt-1',
            status: 'failed',
          }),
          expect.objectContaining({
            attemptId: 'reported-actual-attempt-2',
            status: 'failed',
          }),
        ]),
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('retains the workspace when start-failure session authority is present but unreadable', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockImplementationOnce(
      async () => {
        const error = Object.defineProperty(
          {
            message: 'Start failure returned hostile session authority.',
            quiescent: true,
            recoveryRequired: false,
          },
          'sessionAttempts',
          {
            enumerable: true,
            get: () => {
              throw new Error('unreadable session attempts');
            },
          }
        );
        return { success: false, error } as never;
      }
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'e2e-attempt-1',
        conversationId: 'e2e-conversation-1',
      })
    );
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('does not reset the durable attempt cap when an interrupted phase resumes', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const priorAttempt = historicalE2EAttempt(1);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({
        e2eAttemptsConsumed: 3,
        sessionAttempts: [...loop.state!.sessionAttempts, priorAttempt],
      }),
      phase: { ...phase, attempts: 3 },
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'attempts-exhausted', attempt: 3 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('reserves ledger capacity only for attempts remaining after restart', async () => {
    const harness = makeHarness([{ finalText: 'unused' }, { finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const priorAttempt = historicalE2EAttempt(1);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({
        e2eAttemptsConsumed: 1,
        sessionAttempts: [
          ...historicalAttempts(
            1_024 -
              2 * CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT -
              loop.state!.sessionAttempts.length -
              1
          ),
          ...loop.state!.sessionAttempts,
          priorAttempt,
        ],
      }),
      phase: { ...phase, attempts: 1 },
    });

    expect(result).toMatchObject({ success: true, data: { lastWorkspaceDestroyed: true } });
    expect(harness.dependencies.cleanRoom.create).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, verificationRunId: 'verification-run-2' })
    );
  }, 60_000);

  it('persists a correction handoff before invoking integration side effects', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    const progress = vi.mocked(harness.dependencies.progress.commit);
    const originalProgress = progress.getMockImplementation()!;
    let durableRetrySources: string[] = [];
    progress.mockImplementation(async (input) => {
      const result = await originalProgress(input);
      if (result.success) {
        durableRetrySources =
          result.data.phaseState?.retryHandoffs.map((handoff) => handoff.source) ?? [];
      }
      return result;
    });
    let sourcesAtIntegration: string[] = [];
    vi.mocked(harness.dependencies.cleanRoom.integrateFix).mockImplementationOnce(async () => {
      sourcesAtIntegration = [...durableRetrySources];
      return err({ message: 'integration transport disconnected after invocation' });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { stage: 'correction', recoveryRequired: true },
    });
    expect(sourcesAtIntegration).toContain('Clean-room E2E correction');
    expect(harness.dependencies.cleanRoom.integrateFix).toHaveBeenCalledOnce();
  });

  it.each(['retry-handoff', 'integrating-workspace'] as const)(
    'cleans with prior replay authority when the correction %s CAS rejects',
    async (failurePoint) => {
      const harness = makeHarness([
        {
          finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
          postHead: FIX_COMMIT,
          mutated: true,
        },
      ]);
      const progress = vi.mocked(harness.dependencies.progress.commit);
      const originalProgress = progress.getMockImplementation()!;
      progress.mockImplementation(async (input) => {
        const shouldFail =
          (failurePoint === 'retry-handoff' && input.transition.kind === 'retry-handoffs') ||
          (failurePoint === 'integrating-workspace' &&
            input.transition.kind === 'workspace' &&
            input.transition.verification?.status === 'integrating-fix');
        return shouldFail
          ? err({ message: `${failurePoint} CAS rejected` })
          : originalProgress(input);
      });

      const result = await harness.gate.run(defaultInput);
      const durable = await harness.dependencies.progress.read({
        loopId: loop.id,
        phaseId: phase.id,
      });

      expect(result).toMatchObject({
        success: false,
        error: { stage: 'progress', lastWorkspaceDestroyed: true },
      });
      expect(durable).toMatchObject({ success: true, data: { loopState: { verification: null } } });
      expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.integrateFix).not.toHaveBeenCalled();
    }
  );

  it.each([
    { name: 'local', target: featureTarget, inputProject: project },
    {
      name: 'SSH',
      target: sshFeatureTarget,
      inputProject: {
        ...project,
        defaultWorkspaceMachine: sshFeatureTarget.machine,
      } as unknown as CleanRoomProject,
    },
  ] as const)(
    'accepts the exact production getTaskEnvVars overlay for $name execution',
    async ({ target, inputProject }) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], target);
      const acquire = vi.mocked(harness.dependencies.execution.acquire);
      const originalAcquire = acquire.getMockImplementation()!;
      acquire.mockImplementationOnce(async (input) => {
        const acquired = await originalAcquire(input);
        if (!acquired.success) return acquired;
        const taskEnvironment = getTaskEnvVars({
          taskId: defaultInput.task.id,
          taskName: defaultInput.task.name,
          taskPath: input.cleanRoom.target.path,
          projectPath: inputProject.repoPath,
          defaultBranch: 'main',
          portSeed: input.cleanRoom.target.path,
        });
        return ok({
          ...acquired.data,
          taskEnvironment,
          executionTarget: { ...acquired.data.executionTarget, taskEnv: taskEnvironment },
        });
      });

      const result = await harness.gate.run({
        ...defaultInput,
        project: inputProject,
        featureTarget: target,
      });

      expect(result).toMatchObject({ success: true, data: { lastWorkspaceDestroyed: true } });
      const cleanTarget = cleanTargetFor(target);
      const expectedEnvironment = getTaskEnvVars({
        taskId: defaultInput.task.id,
        taskName: defaultInput.task.name,
        taskPath: cleanTarget.path,
        projectPath: inputProject.repoPath,
        defaultBranch: 'main',
        portSeed: cleanTarget.path,
      });
      expect(
        vi.mocked(harness.dependencies.session.startFreshE2ESession).mock.calls[0]?.[0]
          .taskEnvironment
      ).toEqual(expectedEnvironment);
      expect(
        vi.mocked(harness.dependencies.requiredChecks.run).mock.calls[0]?.[0].taskEnvironment
      ).toEqual(expectedEnvironment);
    }
  );

  it('never terminalizes a phase after the initial progress CAS rejects', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.progress.commit).mockResolvedValue(
      err({ message: 'progress store unavailable' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { stage: 'progress', recoveryRequired: true },
    });
    expect(
      vi
        .mocked(harness.dependencies.progress.commit)
        .mock.calls.some(([input]) => input.transition.kind === 'terminal')
    ).toBe(false);
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('reads back an ambiguous progress commit before deciding terminal authority', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    let durable: E2EDurableProgress | undefined;
    vi.mocked(harness.dependencies.progress.commit).mockImplementationOnce(async (input) => {
      const committed = reduceE2EProgress(input.expected, input.transition);
      if (!committed.success) return committed;
      durable = committed.data;
      throw new Error('transport disconnected after commit');
    });
    vi.mocked(harness.dependencies.progress.read).mockImplementation(async () =>
      durable ? ok(durable) : err({ message: 'durable authority unavailable' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: true,
      data: { lastWorkspaceDestroyed: true },
    });
    expect(harness.dependencies.progress.read).toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('preserves stronger cleanup recovery authority after a mid-lifecycle CAS failure', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const progress = vi.mocked(harness.dependencies.progress.commit);
    const originalProgress = progress.getMockImplementation()!;
    progress.mockImplementation(async (input) => {
      if (
        input.transition.kind === 'workspace' &&
        input.transition.verification?.status === 'ready'
      ) {
        return err({ message: 'ready progress CAS failed' });
      }
      if (input.transition.kind === 'workspace' && input.transition.verification === null) {
        return err({ message: 'destroyed workspace progress could not be cleared' });
      }
      return originalProgress(input);
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'progress',
        message: expect.stringContaining('could not be cleared'),
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    expect(progress.mock.calls.some(([input]) => input.transition.kind === 'terminal')).toBe(false);
  });

  it('reports the latest reconciled feature head after repeated post-integration drift', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    const firstDrift = '4'.repeat(40);
    const latestDrift = '5'.repeat(40);
    vi.mocked(harness.dependencies.authority.inspectFeature)
      .mockResolvedValueOnce(
        ok({ target: featureTarget, headCommit: firstDrift, clean: true, branchAttached: true })
      )
      .mockResolvedValueOnce(
        ok({ target: featureTarget, headCommit: latestDrift, clean: true, branchAttached: true })
      );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'feature-head-drift', featureHead: latestDrift, recoveryRequired: true },
    });
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'whitespace-normalized phase identity',
      ' phase-e2e ',
      () => ({
        ...defaultInput,
        phase: { ...phase, id: ' phase-e2e ' },
      }),
    ],
    [
      'secret-bearing phase identity',
      'token=phase-identity-secret',
      () => ({
        ...defaultInput,
        phase: { ...phase, id: 'token=phase-identity-secret' },
      }),
    ],
    [
      'secret-bearing historical attempt error',
      'password=historical-attempt-secret',
      () => ({
        ...defaultInput,
        loop: loopWithState({
          sessionAttempts: [
            ...loop.state!.sessionAttempts,
            {
              ...historicalE2EAttempt(1),
              error: 'password=historical-attempt-secret',
            },
          ],
        }),
      }),
    ],
    [
      'secret-bearing phase handoff',
      'authorization=phase-handoff-secret',
      () => ({
        ...defaultInput,
        phase: {
          ...phase,
          state: {
            version: '2' as const,
            checkpointCommit: FEATURE_COMMIT,
            handoff: {
              summary: 'authorization=phase-handoff-secret',
              risks: [],
              remainingWork: [],
              artifacts: [],
              createdAt: '2026-07-12T00:20:00.000Z',
            },
            retryHandoffs: [],
            result: null,
          },
        },
      }),
    ],
    [
      'extra criterion key',
      'criterion-extra-secret',
      () => ({
        ...defaultInput,
        phase: {
          ...phase,
          criteria: {
            version: '1' as const,
            criteria: [
              {
                ...E2E_CRITERIA[0],
                injected: 'criterion-extra-secret',
              } as unknown as LoopPhaseCriterion,
            ],
          },
        },
      }),
    ],
  ] as const)(
    'rejects raw noncanonical persisted authority with a %s before any CAS',
    async (_name, secret, makeInput) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

      const result = await harness.gate.run(makeInput() as RunCleanRoomE2EGateInput);

      expect(result).toMatchObject({
        success: false,
        error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
    }
  );

  it('rejects aggregate E2E criteria data beyond the bounded prompt contract', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const oversizedCriteria = Array.from({ length: 64 }, (_, index) => ({
      description: `${index}:${'x'.repeat(16_384)}`,
      verifier: index === 0 ? ('agent-browser' as const) : ('gh' as const),
      status: 'pending' as const,
    }));

    const result = await harness.gate.run({
      ...defaultInput,
      phase: {
        ...phase,
        criteria: { version: '1', criteria: oversizedCriteria },
      },
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('never emits a terminal attempt timestamp earlier than its durable start', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    let nowCalls = 0;
    harness.dependencies.now = vi.fn(() => {
      nowCalls += 1;
      return new Date(nowCalls <= 5 ? '2026-07-12T03:00:00.000Z' : '2026-07-12T02:00:00.000Z');
    });

    const result = await harness.gate.run(defaultInput);
    const attempts = result.success ? result.data.sessionAttempts : result.error.sessionAttempts;

    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      if (attempt.finishedAt === undefined) continue;
      expect(Date.parse(attempt.finishedAt)).toBeGreaterThanOrEqual(Date.parse(attempt.startedAt));
    }
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each(['ready', 'running'] as const)(
    'keeps workspace transitions monotonic when the clock rolls back after %s',
    async (rollbackAfter) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      const progress = vi.mocked(harness.dependencies.progress.commit);
      const originalProgress = progress.getMockImplementation()!;
      const workspaceTimestamps: string[] = [];
      let clockRolledBack = false;
      progress.mockImplementation(async (input) => {
        if (input.transition.kind === 'workspace' && input.transition.verification !== null) {
          workspaceTimestamps.push(input.transition.verification.cleanup.updatedAt);
        }
        const result = await originalProgress(input);
        if (
          result.success &&
          input.transition.kind === 'workspace' &&
          input.transition.verification?.status === rollbackAfter
        ) {
          clockRolledBack = true;
        }
        return result;
      });
      harness.dependencies.now = vi.fn(
        () => new Date(clockRolledBack ? '2026-07-12T01:00:00.000Z' : '2026-07-12T02:00:00.000Z')
      );

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({ success: true, data: { lastWorkspaceDestroyed: true } });
      expect(workspaceTimestamps.length).toBeGreaterThanOrEqual(4);
      for (let index = 1; index < workspaceTimestamps.length; index += 1) {
        expect(Date.parse(workspaceTimestamps[index]!)).toBeGreaterThanOrEqual(
          Date.parse(workspaceTimestamps[index - 1]!)
        );
      }
      expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    }
  );

  const targetEchoMachines = [
    { name: 'local', target: featureTarget, inputProject: project },
    {
      name: 'SSH',
      target: sshFeatureTarget,
      inputProject: {
        ...project,
        defaultWorkspaceMachine: sshFeatureTarget.machine,
      } as unknown as CleanRoomProject,
    },
  ] as const;
  const targetEchoPorts = [
    {
      port: 'binding',
      errorType: 'execution-target-drift',
      stage: 'execution',
      releaseCount: 0,
      destroyCount: 0,
      destroyed: false,
    },
    {
      port: 'session',
      errorType: 'session-authority-invalid',
      stage: 'session-start',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'prompt',
      errorType: 'prompt-authority-invalid',
      stage: 'prompt',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'checks',
      errorType: 'required-checks-authority-invalid',
      stage: 'required-checks',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'native',
      errorType: 'native-verifier-authority-invalid',
      stage: 'required-checks',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'nested',
      errorType: 'native-verifier-ledger-invalid',
      stage: 'required-checks',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'cancel',
      errorType: 'dependency-rejected',
      stage: 'quiescence',
      releaseCount: 0,
      destroyCount: 0,
      destroyed: false,
    },
    {
      port: 'release',
      errorType: 'cleanup-failed',
      stage: 'cleanup',
      releaseCount: 1,
      destroyCount: 0,
      destroyed: false,
    },
    {
      port: 'final',
      errorType: 'feature-head-drift',
      stage: 'finalize',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
  ] as const satisfies readonly {
    port: TargetEchoPort;
    errorType: string;
    stage: string;
    releaseCount: number;
    destroyCount: number;
    destroyed: boolean;
  }[];

  for (const machine of targetEchoMachines) {
    for (const expectation of targetEchoPorts) {
      it(`rejects a whitespace-normalized ${machine.name} ${expectation.port} target echo`, async () => {
        const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], machine.target);
        arrangeWhitespaceTargetEcho(
          harness,
          expectation.port,
          cleanTargetFor(machine.target),
          machine.target
        );

        const result = await harness.gate.run({
          ...defaultInput,
          project: machine.inputProject,
          featureTarget: machine.target,
        });

        expect(result).toMatchObject({
          success: false,
          error: {
            type: expectation.errorType,
            stage: expectation.stage,
            lastWorkspaceDestroyed: expectation.destroyed,
          },
        });
        expect(harness.dependencies.execution.release).toHaveBeenCalledTimes(
          expectation.releaseCount
        );
        expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledTimes(
          expectation.destroyCount
        );
      });
    }
  }
});
