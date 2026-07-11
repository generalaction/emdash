import { describe, expect, it } from 'vitest';
import { buildLoopPhaseHandoff } from './handoff-builder';
import {
  buildTerminalReviewPrompt,
  parseTerminalReviewSentinel,
  TERMINAL_REVIEW_FAILED_PREFIX,
  TERMINAL_REVIEW_PASSED_SENTINEL,
} from './terminal-review-prompt';

const input = {
  goal: 'Ship ACP Loops v2.',
  acceptanceCriteria: ['Local and SSH execution remain equivalent.'],
  baseCommit: '1'.repeat(40),
  checkpointCommit: '2'.repeat(40),
  handoffs: [
    {
      source: 'Work phase 1',
      handoff: buildLoopPhaseHandoff({
        summary: 'Implemented the prompt contract.',
        risks: ['Renderer integration is pending.'],
        remainingWork: ['Run terminal Review.'],
        artifacts: [],
        createdAt: '2026-07-11T20:00:00.000Z',
        chatHistory: 'REVIEW_PRIVATE_TRANSCRIPT',
        stdout: 'REVIEW_SECRET_STDOUT',
        stderr: 'REVIEW_SECRET_STDERR',
        command: 'REVIEW_SECRET_COMMAND',
        path: '/secret/review-path',
        environment: { TOKEN: 'REVIEW_SECRET_ENV' },
        cookie: 'REVIEW_SECRET_COOKIE',
        credential: 'REVIEW_SECRET_CREDENTIAL',
        screenshot: 'REVIEW_SECRET_SCREENSHOT',
      } as Parameters<typeof buildLoopPhaseHandoff>[0]),
    },
  ],
};

describe('terminal Review prompt', () => {
  it('reviews the complete checkpoint range with the full plan checklist and correction authority', () => {
    const prompt = buildTerminalReviewPrompt(input);

    expect(prompt).toContain('complete immutable base-to-checkpoint change');
    expect(prompt).toContain('1111111111111111111111111111111111111111');
    expect(prompt).toContain('2222222222222222222222222222222222222222');
    for (const item of [
      'correctness',
      'unnecessary verbosity or complexity',
      'duplication',
      'repository conventions',
      'modular experimental isolation',
      'security',
      'local and SSH parity',
      'loading and error states',
      'tests',
      'specifications',
      'documentation',
      'dead code',
    ]) {
      expect(prompt).toContain(item);
    }
    expect(prompt).toContain('fix findings');
    expect(prompt).toContain('local checkpoint');
    expect(prompt).toContain('Never push');
    expect(prompt).not.toContain('diff --git');
    for (const secret of [
      'REVIEW_PRIVATE_TRANSCRIPT',
      'REVIEW_SECRET_STDOUT',
      'REVIEW_SECRET_STDERR',
      'REVIEW_SECRET_COMMAND',
      '/secret/review-path',
      'REVIEW_SECRET_ENV',
      'REVIEW_SECRET_COOKIE',
      'REVIEW_SECRET_CREDENTIAL',
      'REVIEW_SECRET_SCREENSHOT',
    ]) {
      expect(prompt).not.toContain(secret);
    }
  });

  it('accepts exactly one bounded terminal sentinel on the final non-empty line', () => {
    expect(
      parseTerminalReviewSentinel(`Review complete.\n${TERMINAL_REVIEW_PASSED_SENTINEL}`)
    ).toEqual({ kind: 'passed' });
    expect(
      parseTerminalReviewSentinel(
        `Blocked.\n${TERMINAL_REVIEW_FAILED_PREFIX} remote tests failed>>>`
      )
    ).toEqual({ kind: 'failed', reason: 'remote tests failed' });

    expect(parseTerminalReviewSentinel(`${TERMINAL_REVIEW_PASSED_SENTINEL}\nmore text`)).toBeNull();
    expect(
      parseTerminalReviewSentinel(
        `${TERMINAL_REVIEW_FAILED_PREFIX} blocked>>>\n${TERMINAL_REVIEW_PASSED_SENTINEL}`
      )
    ).toBeNull();
    expect(
      parseTerminalReviewSentinel(
        `${TERMINAL_REVIEW_PASSED_SENTINEL}\n${TERMINAL_REVIEW_PASSED_SENTINEL}`
      )
    ).toBeNull();
    expect(
      parseTerminalReviewSentinel(
        `${TERMINAL_REVIEW_FAILED_PREFIX} first>>>\n${TERMINAL_REVIEW_FAILED_PREFIX} second>>>`
      )
    ).toBeNull();
    expect(
      parseTerminalReviewSentinel(`${TERMINAL_REVIEW_FAILED_PREFIX} ${'x'.repeat(2_049)}>>>`)
    ).toBeNull();
    expect(
      parseTerminalReviewSentinel(
        `${TERMINAL_REVIEW_FAILED_PREFIX} ${'x'.repeat(2_049)}>>>\n${TERMINAL_REVIEW_PASSED_SENTINEL}`
      )
    ).toBeNull();
  });
});
