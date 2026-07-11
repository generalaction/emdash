import { describe, expect, it } from 'vitest';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import {
  buildE2EPrompt,
  E2E_CORRECTION_READY_PREFIX,
  E2E_FAILED_PREFIX,
  E2E_PASSED_SENTINEL,
  parseE2ESentinel,
} from './e2e-prompt';
import { buildLoopPhaseHandoff } from './handoff-builder';
import { nativeBrowserActionPromptFragment } from './verifiers/native-browser-protocol';

function makeInput(target: LoopSessionTarget) {
  const failure = buildLoopPhaseHandoff({
    summary: 'Attempt 1 exposed a navigation defect.',
    risks: ['The correction still needs an independent replay.'],
    remainingWork: ['Recreate from the frozen base.'],
    artifacts: [
      {
        artifactId: 'browser-diagnostics-1',
        kind: 'browser-diagnostics' as const,
        byteLength: 512,
        createdAt: '2026-07-11T20:00:00.000Z',
        path: '/secret/e2e-artifact',
        contents: 'E2E_SECRET_CONTENTS',
      },
    ],
    createdAt: '2026-07-11T20:01:00.000Z',
    chatHistory: 'E2E_PRIVATE_TRANSCRIPT',
    stdout: 'E2E_SECRET_STDOUT',
    stderr: 'E2E_SECRET_STDERR',
    command: 'E2E_SECRET_COMMAND',
    environment: { TOKEN: 'E2E_SECRET_ENV' },
    cookie: 'E2E_SECRET_COOKIE',
    credential: 'E2E_SECRET_CREDENTIAL',
    screenshot: 'E2E_SECRET_SCREENSHOT',
  } as unknown as Parameters<typeof buildLoopPhaseHandoff>[0]);

  return {
    goal: 'Verify ACP Loops v2 independently.',
    acceptanceCriteria: ['The native preview passes on the bound workspace.'],
    baseCommit: '1'.repeat(40),
    checkpointCommit: '2'.repeat(40),
    handoffs: [],
    verificationRunId: 'verification-run-2',
    verificationTarget: target,
    attempt: 2,
    intermediateFailures: [{ source: 'E2E attempt 1', handoff: failure }],
  };
}

describe('independent clean-room E2E prompt', () => {
  it.each([
    {
      workspaceId: 'verification-local',
      path: '/tmp/verification-local',
      machine: { kind: 'local' as const },
    },
    {
      workspaceId: 'verification-ssh',
      path: '/srv/emdash/verification-ssh',
      machine: { kind: 'ssh' as const, connectionId: 'ssh-1' },
    },
  ])('binds all work to the explicit $machine.kind target', (target) => {
    const prompt = buildE2EPrompt(makeInput(target));

    expect(prompt).toContain(`"workspaceId":"${target.workspaceId}"`);
    expect(prompt).toContain(`"path":"${target.path}"`);
    expect(prompt).toContain(`"kind":"${target.machine.kind}"`);
    expect(prompt).toContain('verification-run-2');
    expect(prompt).toContain('Never switch targets or fall back to another local workspace');
    expect(prompt).toContain('Do not construct a separate SSH transport');
  });

  it('uses the audited native action fragment and preserves failure evidence across recreation', () => {
    const prompt = buildE2EPrompt(
      makeInput({
        workspaceId: 'verification-local',
        path: '/tmp/verification-local',
        machine: { kind: 'local' },
      })
    );

    expect(prompt).toContain(nativeBrowserActionPromptFragment);
    expect(prompt).toContain('Attempt 1 exposed a navigation defect.');
    expect(prompt).toContain('append-only');
    expect(prompt).toContain('destroyed and recreated from the frozen base');
    expect(prompt).toContain('If you made any repository mutation during this attempt');
    expect(prompt).toContain('modified, added or untracked, or deleted files');
    expect(prompt).toContain('created a correction checkpoint');
    expect(prompt).toContain(E2E_CORRECTION_READY_PREFIX);
    expect(prompt).toContain(E2E_PASSED_SENTINEL);
    expect(prompt).not.toContain('Agent Browser');
    expect(prompt).not.toContain('agent-browser');
    expect(prompt).not.toContain('executeJavaScript');
    expect(prompt).not.toContain('CDP');
    for (const secret of [
      '/secret/e2e-artifact',
      'E2E_SECRET_CONTENTS',
      'E2E_PRIVATE_TRANSCRIPT',
      'E2E_SECRET_STDOUT',
      'E2E_SECRET_STDERR',
      'E2E_SECRET_COMMAND',
      'E2E_SECRET_ENV',
      'E2E_SECRET_COOKIE',
      'E2E_SECRET_CREDENTIAL',
      'E2E_SECRET_SCREENSHOT',
    ]) {
      expect(prompt).not.toContain(secret);
    }
  });

  it('parses one final outcome and rejects correction/pass conflicts', () => {
    expect(parseE2ESentinel(`Green.\n${E2E_PASSED_SENTINEL}`)).toEqual({ kind: 'passed' });
    expect(parseE2ESentinel(`${E2E_CORRECTION_READY_PREFIX} fixed navigation state>>>`)).toEqual({
      kind: 'correction-ready',
      summary: 'fixed navigation state',
    });
    expect(parseE2ESentinel(`${E2E_FAILED_PREFIX} preview did not start>>>`)).toEqual({
      kind: 'failed',
      reason: 'preview did not start',
    });
    expect(
      parseE2ESentinel(`${E2E_CORRECTION_READY_PREFIX} fixed defect>>>\n${E2E_PASSED_SENTINEL}`)
    ).toBeNull();
    expect(parseE2ESentinel(`${E2E_PASSED_SENTINEL}\n${E2E_PASSED_SENTINEL}`)).toBeNull();
    expect(
      parseE2ESentinel(`${E2E_FAILED_PREFIX} first>>>\n${E2E_FAILED_PREFIX} second>>>`)
    ).toBeNull();
    expect(parseE2ESentinel(`${E2E_PASSED_SENTINEL}\nnot final`)).toBeNull();
    expect(parseE2ESentinel(`${E2E_FAILED_PREFIX} ${'x'.repeat(2_049)}>>>`)).toBeNull();
    expect(parseE2ESentinel(`${E2E_CORRECTION_READY_PREFIX} ${'x'.repeat(2_049)}>>>`)).toBeNull();
    expect(
      parseE2ESentinel(
        `${E2E_CORRECTION_READY_PREFIX} ${'x'.repeat(2_049)}>>>\n${E2E_PASSED_SENTINEL}`
      )
    ).toBeNull();
  });

  it.each([
    ['NUL', 'bad\u0000reason'],
    ['vertical tab', 'bad\u000breason'],
    ['ANSI escape', 'bad\u001b[31mreason'],
    ['C1 control', 'bad\u0085reason'],
    ['Unicode format control', 'bad\u200breason'],
    ['Unicode bidi override', 'bad\u202ereason'],
    ['Unicode bidi isolate', 'bad\u2066reason'],
    ['Unicode line separator', 'bad\u2028reason'],
    ['Unicode paragraph separator', 'bad\u2029reason'],
  ])('rejects %s in strict E2E outcome details', (_label, reason) => {
    expect(parseE2ESentinel(`${E2E_FAILED_PREFIX} ${reason}>>>`)).toBeNull();
    expect(parseE2ESentinel(`${E2E_CORRECTION_READY_PREFIX} ${reason}>>>`)).toBeNull();
  });

  it('rejects invalid full commits and verification targets before rendering', () => {
    const valid = makeInput({
      workspaceId: 'verification-local',
      path: '/tmp/verification-local',
      machine: { kind: 'local' },
    });

    expect(() => buildE2EPrompt({ ...valid, baseCommit: 'short' })).toThrow();
    expect(() =>
      buildE2EPrompt({
        ...valid,
        verificationTarget: { ...valid.verificationTarget, path: '' },
      })
    ).toThrow();
  });

  it('rejects an aggregate payload that exceeds the cap only after E2E evidence is combined', () => {
    const target = {
      workspaceId: 'verification-local',
      path: '/tmp/verification-local',
      machine: { kind: 'local' as const },
    };
    const maximalHandoff = buildLoopPhaseHandoff({
      summary: 's'.repeat(16_384),
      risks: Array.from({ length: 64 }, () => 'r'.repeat(2_048)),
      remainingWork: Array.from({ length: 64 }, () => 'w'.repeat(2_048)),
      artifacts: [],
      createdAt: '2026-07-11T20:01:00.000Z',
    });
    const aggregate = {
      ...makeInput(target),
      handoffs: [{ source: 'Review', handoff: maximalHandoff }],
      intermediateFailures: [{ source: 'E2E attempt 1', handoff: maximalHandoff }],
    };

    expect(() => buildE2EPrompt(aggregate)).toThrow(/prompt data exceeds/i);
  });
});
