import { describe, expect, it } from 'vitest';
import type { LoopWithPhases } from '@shared/core/loops/loops';
import {
  loopPhaseProgress,
  loopStatusMeta,
  parseVerifierEvidence,
  phaseStatusMeta,
  statusDotClass,
  verifierLabel,
} from './loop-format';

function makeLoop(phases: LoopWithPhases['phases']): LoopWithPhases {
  return {
    id: 'loop-1',
    projectId: 'project-1',
    taskId: 'task-1',
    name: 'Loop',
    slug: 'loop',
    status: 'running',
    currentPhaseIndex: 1,
    config: null,
    phases,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('loop-format', () => {
  it('maps loop and phase statuses to labels and tones', () => {
    expect(loopStatusMeta('running')).toEqual({ label: 'Running', tone: 'info' });
    expect(loopStatusMeta('completed')).toEqual({ label: 'Completed', tone: 'success' });
    expect(phaseStatusMeta('verifying')).toEqual({ label: 'Verifying', tone: 'info' });
    expect(phaseStatusMeta('failed')).toEqual({ label: 'Failed', tone: 'danger' });
    expect(statusDotClass('success')).toContain('bg-foreground-success');
  });

  it('returns stable verifier labels', () => {
    expect(verifierLabel('gh')).toBe('GitHub checks');
    expect(verifierLabel('agent-browser')).toBe('Agent Browser');
  });

  it('counts passed phases for progress', () => {
    const loop = makeLoop([
      {
        id: 'phase-1',
        loopId: 'loop-1',
        idx: 0,
        name: 'One',
        goal: 'One',
        status: 'passed',
        attempts: 1,
        conversationId: null,
        criteria: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'phase-2',
        loopId: 'loop-1',
        idx: 1,
        name: 'Two',
        goal: 'Two',
        status: 'failed',
        attempts: 3,
        conversationId: null,
        criteria: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(loopPhaseProgress(loop)).toEqual({ passed: 1, total: 2 });
  });

  it('parses verifier evidence JSON and falls back for plain text', () => {
    expect(
      parseVerifierEvidence(
        JSON.stringify({
          summary: 'Checks passed',
          command: 'pnpm run test',
          exitCode: 0,
          durationMs: 1200,
          stdoutTail: 'ok',
          evidencePath: '.emdash-loops-evidence/phase.json',
        })
      )
    ).toEqual({
      summary: 'Checks passed',
      command: 'pnpm run test',
      exitCode: 0,
      durationMs: 1200,
      stdoutTail: 'ok',
      stderrTail: undefined,
      evidencePath: '.emdash-loops-evidence/phase.json',
    });

    expect(parseVerifierEvidence('raw verifier output')).toEqual({
      summary: 'raw verifier output',
    });
  });

  it('renders a summary fallback from evidence output when stored summary is empty', () => {
    expect(
      parseVerifierEvidence(
        JSON.stringify({
          summary: '',
          command: 'pnpm test',
          exitCode: 0,
          durationMs: 250,
          stdoutTail: 'tests passed',
        })
      )
    ).toEqual({
      summary: 'tests passed',
      command: 'pnpm test',
      exitCode: 0,
      durationMs: 250,
      stdoutTail: 'tests passed',
      stderrTail: undefined,
      evidencePath: undefined,
    });
  });
});
