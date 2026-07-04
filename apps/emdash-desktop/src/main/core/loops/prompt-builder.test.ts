import { describe, expect, it } from 'vitest';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import {
  buildPhasePrompt,
  buildReviewPrompt,
  parsePhaseSentinel,
  parseReviewSentinel,
} from './prompt-builder';

const loop: Loop = {
  id: 'loop-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'ACP Loops',
  slug: 'acp-loops',
  status: 'running',
  currentPhaseIndex: 0,
  config: {
    version: '1',
    verifiers: ['gh', 'agent-browser'],
    reviewEnabled: true,
    validationCommands: ['pnpm run test', 'pnpm run lint'],
    planSource: 'docs/plans/acp-loops.md',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const phase: LoopPhase = {
  id: 'phase-1',
  loopId: loop.id,
  idx: 0,
  name: 'Engine',
  goal: 'Build the main-process loop engine.',
  status: 'pending',
  attempts: 0,
  conversationId: null,
  criteria: {
    version: '1',
    criteria: [
      {
        description: 'GitHub checks are green',
        verifier: 'gh',
        status: 'pending',
      },
      {
        description: 'Browser can verify the control panel',
        verifier: 'agent-browser',
        status: 'pending',
      },
    ],
  },
  lastError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('loop prompt builder', () => {
  it('builds a ralphex-style phase prompt', () => {
    expect(buildPhasePrompt({ loop, phase, attempt: 1 })).toMatchInlineSnapshot(`
      "You are running an Emdash Loop phase.

      Loop: ACP Loops
      Phase 1: Engine
      Attempt: 1

      Goal:
      Build the main-process loop engine.

      Pass criteria:
      - [ ] (gh) GitHub checks are green
      - [ ] (agent-browser) Browser can verify the control panel

      Validation commands the loop engine will run after your turn:
      - pnpm run test
      - pnpm run lint

      Required workflow:
      1. ANNOUNCE: Briefly state the phase, intended files, and validation plan.
      2. IMPLEMENT: Make the smallest correct change for this phase. Write unit tests first or alongside the implementation. This unit-test layer is mandatory.
      3. VALIDATE: Run the validation commands yourself until they are green, or stop with an exact blocker you cannot resolve.
      4. HONESTY: Never claim success you have not verified. If a command was not run, say exactly why. If blocked, record the exact command, error, and current state.

      End your final response with exactly one sentinel:
      - <<<LOOP:PHASE_DONE>>>
      - <<<LOOP:PHASE_FAILED reason>>>

      Do not use a done sentinel unless the phase goal and pass criteria are actually satisfied."
    `);
  });

  it('builds a review prompt with the phase diff', () => {
    expect(
      buildReviewPrompt({
        loop,
        phase,
        diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
      })
    ).toContain('<<<LOOP:REVIEW_APPROVED>>>');
    expect(
      buildReviewPrompt({
        loop,
        phase,
        diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
      })
    ).toContain('+export const value = 1;');
  });

  it('parses phase sentinels', () => {
    expect(parsePhaseSentinel('done\n<<<LOOP:PHASE_DONE>>>')).toEqual({ kind: 'done' });
    expect(parsePhaseSentinel('nope <<<LOOP:PHASE_FAILED tests are red>>>')).toEqual({
      kind: 'failed',
      reason: 'tests are red',
    });
    expect(parsePhaseSentinel('missing')).toBeNull();
  });

  it('parses review sentinels', () => {
    expect(parseReviewSentinel('ok <<<LOOP:REVIEW_APPROVED>>>')).toEqual({
      kind: 'approved',
    });
    expect(parseReviewSentinel('fix <<<LOOP:REVIEW_CHANGES add tests>>>')).toEqual({
      kind: 'changes',
      feedback: 'add tests',
    });
    expect(parseReviewSentinel('missing')).toBeNull();
  });
});
