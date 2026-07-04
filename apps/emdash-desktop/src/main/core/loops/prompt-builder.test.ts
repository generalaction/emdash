import { describe, expect, it } from 'vitest';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import {
  buildAgentBrowserVerificationPrompt,
  buildPhasePrompt,
  buildReviewPrompt,
  parsePhaseSentinel,
  parseReviewSentinel,
  parseVerificationSentinel,
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

  it('builds an agent-browser verification prompt', () => {
    expect(
      buildAgentBrowserVerificationPrompt({
        loop: {
          ...loop,
          config: {
            ...loop.config!,
            agentBrowser: { targetUrl: 'http://localhost:5173', cdpPort: 9222 },
          },
        },
        phase,
        criteria: phase.criteria!.criteria.filter(
          (criterion) => criterion.verifier === 'agent-browser'
        ),
        cwd: '/tmp/worktree',
        evidenceDir: '/tmp/worktree/.emdash-loops-evidence/loop-1/phase-1',
      })
    ).toMatchInlineSnapshot(`
      "You are an Emdash Loop VERIFICATION agent.

      Loop: ACP Loops
      Phase 1: Engine

      You must NOT modify code, config, tests, or documentation. Your only job is to inspect the running UI and report whether the agent-browser criteria are actually satisfied.

      Agent Browser criteria to verify:
      1. Browser can verify the control panel

      Target:
      - Target URL: http://localhost:5173
      - CDP port: 9222
      - Worktree: /tmp/worktree
      - Screenshots/evidence directory: /tmp/worktree/.emdash-loops-evidence/loop-1/phase-1

      Required workflow:
      1. Stay in the current worktree. If no target URL is configured, or if a configured target URL does not respond, start the project's dev server from this worktree in the background. Inspect package.json scripts and use the appropriate script, for example pnpm dev, then wait until it serves.
      2. Drive the UI with the real agent-browser CLI primitives. Use commands such as agent-browser open, agent-browser connect, agent-browser snapshot -i, agent-browser click, agent-browser fill, agent-browser read, and agent-browser screenshot.
      3. Verify EACH numbered criterion honestly against observed UI behavior. Do not infer success from code, logs, or intent alone.
      4. Save screenshots under /tmp/worktree/.emdash-loops-evidence/loop-1/phase-1. Use descriptive filenames tied to the criteria when practical.
      5. Report the exact observed result for each criterion. If you cannot start or reach the UI, that is a verification failure with the exact command/error.

      Honesty rules:
      - Do not mark passed unless you actually drove the UI with agent-browser.
      - Do not mark passed for a criterion you did not observe.
      - Do not hide uncertainty. If behavior is ambiguous or blocked, fail with the observed reason.
      - Do not edit files except for screenshots/evidence inside /tmp/worktree/.emdash-loops-evidence/loop-1/phase-1.

      End your final response with exactly one sentinel:
      - <<<LOOP:VERIFY_PASSED>>>
      - <<<LOOP:VERIFY_FAILED criterion-numbers and exact observed reasons>>>"
    `);
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

  it('parses verification sentinels', () => {
    expect(parseVerificationSentinel('ok <<<LOOP:VERIFY_PASSED>>>')).toEqual({
      kind: 'passed',
    });
    expect(parseVerificationSentinel('fail <<<LOOP:VERIFY_FAILED 2: no dialog>>>')).toEqual({
      kind: 'failed',
      reason: '2: no dialog',
    });
    expect(parseVerificationSentinel('missing')).toBeNull();
  });
});
