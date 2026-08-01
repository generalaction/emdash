import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseStateV2Schema, type LoopStageResult } from '@shared/core/loops/loop-phase-state';
import { loopStateV2Schema, type LoopSessionTarget } from '@shared/core/loops/loop-state';
import type { LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import type { LoopSessionDriver } from '../drivers/session-driver';
import {
  TerminalReviewGate,
  type ReviewCorrectionValidation,
  type ReviewGateOutput,
  type ReviewWorkspaceOperationInput,
} from '../gates/review-gate';
import type { LoopPromptHandoff } from '../handoff-builder';
import type { LoopRunControl } from '../phase-runner';
import { runLoopCommand } from './loop-command-runner';
import type { LoopExecutionTarget } from './loop-execution-target';

export type TerminalReviewRuntimeError = { message: string; conversationId?: string };

export async function runTerminalReviewPhase(input: {
  loop: LoopWithPhases;
  phase: LoopPhase;
  executionTarget: LoopExecutionTarget;
  driver: LoopSessionDriver;
  control: LoopRunControl;
}): Promise<Result<ReviewGateOutput, TerminalReviewRuntimeError>> {
  const config = input.loop.config;
  const loopState = loopStateV2Schema.safeParse(input.loop.state);
  if (
    config?.version !== '2' ||
    !loopState.success ||
    !loopState.data.baseCommit ||
    !loopState.data.checkpointCommit ||
    !config.model
  ) {
    return err({ message: 'Terminal Review checkpoint authority is unavailable' });
  }
  const target = sessionTarget(input.executionTarget);
  const startedAt = new Map<string, string>();
  const gate = new TerminalReviewGate({
    session: {
      startFreshReviewSession: async () => {
        const session = await input.driver.startPhaseSession({
          loop: input.loop,
          phase: input.phase,
          purpose: 'review',
          target,
          taskEnvironment: input.executionTarget.taskEnv,
        });
        if (!session.success)
          return err({ type: session.error.kind, message: session.error.message });
        startedAt.set(session.data.conversationId, new Date().toISOString());
        await input.control.setActiveConversation(session.data.conversationId, input.driver);
        return ok({ conversationId: session.data.conversationId, target });
      },
      sendReviewPrompt: async ({ conversationId, prompt }) => {
        const sent = await input.driver.sendPrompt(conversationId, prompt);
        return sent.success
          ? ok({ finalText: sent.data.finalText })
          : err({ type: sent.error.kind, message: sent.error.message });
      },
      cancelReviewSession: async ({ conversationId }) => {
        const cancelled = await input.driver.cancelPrompt(conversationId);
        return cancelled.success
          ? ok({ conversationId, target, quiescent: true as const })
          : err({ type: cancelled.error.kind, message: cancelled.error.message });
      },
    },
    checkpoint: {
      inspectWorkspace: async () =>
        inspectWorkspace(input.executionTarget, target, input.control.signal),
      validateCheckpointRange: async (request) =>
        validateRange(input.executionTarget, target, request, input.control.signal),
      validateCorrection: async (request) =>
        validateCorrection(input.executionTarget, target, request, input.control.signal),
    },
    requiredGate: {
      run: async (request) => {
        for (const command of config.validationCommands) {
          const validation = await runShellCommand(input.executionTarget, command, request.signal);
          if (!validation.success) return validation;
        }
        const inspected = await inspectWorkspace(input.executionTarget, target, request.signal);
        if (!inspected.success) return inspected;
        if (!inspected.data.clean || inspected.data.headCommit !== request.checkpointCommit) {
          return err({
            type: 'checkpoint-drift',
            message: 'Required checks changed the reviewed checkpoint',
          });
        }
        return ok({
          target,
          checkpointCommit: request.checkpointCommit,
          summary: 'Required validation commands passed.',
        });
      },
    },
    now: () => new Date(),
  });

  const workPhases = input.loop.phases.filter((phase) => (phase.kind ?? 'work') === 'work');
  const workPhaseResults = workPhases.flatMap((phase) => {
    const state = loopPhaseStateV2Schema.safeParse(phase.state);
    return state.success && state.data.result ? [state.data.result] : [];
  });
  const handoffs: LoopPromptHandoff[] = workPhases.flatMap((phase) => {
    const state = loopPhaseStateV2Schema.safeParse(phase.state);
    return state.success && state.data.handoff
      ? [{ source: phase.name, handoff: state.data.handoff }]
      : [];
  });
  const acceptanceCriteria = input.loop.phases
    .flatMap((phase) => phase.criteria?.criteria ?? [])
    .map((criterion) => criterion.description);
  const result = await gate.run({
    goal: config.planSource.trim() || input.loop.name,
    acceptanceCriteria:
      acceptanceCriteria.length > 0 ? acceptanceCriteria : workPhases.map((phase) => phase.goal),
    baseCommit: loopState.data.baseCommit,
    checkpointCommit: loopState.data.checkpointCommit,
    handoffs,
    target,
    provider: config.provider,
    model: config.model,
    workPhaseResults: workPhaseResults as LoopStageResult[],
    previousConversationIds: loopState.data.sessionAttempts.map(
      (attempt) => attempt.conversationId
    ),
    signal: input.control.signal,
  });
  await input.control.setActiveConversation(null, null);
  return result.success
    ? result
    : err({
        message: result.error.message,
        ...(result.error.conversationId ? { conversationId: result.error.conversationId } : {}),
      });
}

function sessionTarget(target: LoopExecutionTarget): LoopSessionTarget {
  return { workspaceId: target.workspaceId, path: target.path, machine: target.machine };
}

async function inspectWorkspace(
  executionTarget: LoopExecutionTarget,
  target: LoopSessionTarget,
  signal?: AbortSignal
) {
  try {
    const [head, status] = await Promise.all([
      runLoopCommand(executionTarget, 'git', ['rev-parse', 'HEAD'], { signal }),
      runLoopCommand(executionTarget, 'git', ['status', '--porcelain'], { signal }),
    ]);
    return ok({ target, headCommit: head.stdout.trim(), clean: status.stdout.trim() === '' });
  } catch (error) {
    return err({
      type: 'git-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateRange(
  executionTarget: LoopExecutionTarget,
  target: LoopSessionTarget,
  request: ReviewWorkspaceOperationInput,
  signal?: AbortSignal
) {
  try {
    await runLoopCommand(
      executionTarget,
      'git',
      ['merge-base', '--is-ancestor', request.baseCommit, request.checkpointCommit],
      { signal }
    );
    const merges = await runLoopCommand(
      executionTarget,
      'git',
      ['rev-list', '--count', '--merges', `${request.baseCommit}..${request.checkpointCommit}`],
      { signal }
    );
    return ok({
      target,
      baseCommit: request.baseCommit,
      checkpointCommit: request.checkpointCommit,
      linear: Number(merges.stdout.trim() || '0') === 0,
      loopOwned: true,
    });
  } catch (error) {
    return err({
      type: 'git-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateCorrection(
  executionTarget: LoopExecutionTarget,
  target: LoopSessionTarget,
  request: ReviewWorkspaceOperationInput & { previousCheckpointCommit: string },
  signal?: AbortSignal
): Promise<Result<ReviewCorrectionValidation, { type: string; message: string }>> {
  try {
    const [head, parent, count] = await Promise.all([
      runLoopCommand(executionTarget, 'git', ['rev-parse', 'HEAD'], { signal }),
      runLoopCommand(executionTarget, 'git', ['rev-parse', 'HEAD^'], { signal }),
      runLoopCommand(
        executionTarget,
        'git',
        ['rev-list', '--count', `${request.previousCheckpointCommit}..HEAD`],
        { signal }
      ),
    ]);
    return ok({
      target,
      baseCommit: request.baseCommit,
      previousCheckpointCommit: request.previousCheckpointCommit,
      checkpointCommit: head.stdout.trim(),
      parentCommit: parent.stdout.trim(),
      commitCount: Number(count.stdout.trim()),
      linear: true,
      loopOwned: true,
    });
  } catch (error) {
    return err({
      type: 'git-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runShellCommand(
  target: LoopExecutionTarget,
  command: string,
  signal?: AbortSignal
): Promise<Result<void, { type: string; message: string }>> {
  try {
    if (target.machine.kind === 'ssh') {
      await runLoopCommand(target, 'sh', ['-lc', command], { signal });
    } else {
      await runLoopCommand(target, process.env.SHELL || '/bin/sh', ['-lc', command], { signal });
    }
    return ok();
  } catch (error) {
    return err({
      type: 'validation-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
