import type { LoopStatus, LoopWithPhases, PhaseStatus, VerifierId } from '@shared/core/loops/loops';

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export type StatusMeta = {
  label: string;
  tone: StatusTone;
};

export type ParsedVerifierEvidence = {
  summary?: string;
  command?: string;
  stdoutTail?: string;
  stderrTail?: string;
  evidencePath?: string;
  exitCode?: number | null;
  durationMs?: number;
};

const loopStatusMetaByStatus: Record<LoopStatus, StatusMeta> = {
  draft: { label: 'Draft', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  paused: { label: 'Paused', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' },
};

const phaseStatusMetaByStatus: Record<PhaseStatus, StatusMeta> = {
  pending: { label: 'Pending', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  verifying: { label: 'Verifying', tone: 'info' },
  reviewing: { label: 'Reviewing', tone: 'warning' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

const verifierLabels: Record<VerifierId, string> = {
  gh: 'GitHub checks',
  vercel: 'Vercel deployment',
  convex: 'Convex dry run',
  'agent-browser': 'Agent Browser',
};

export function loopStatusMeta(status: LoopStatus): StatusMeta {
  return loopStatusMetaByStatus[status];
}

export function phaseStatusMeta(status: PhaseStatus): StatusMeta {
  return phaseStatusMetaByStatus[status];
}

export function verifierLabel(verifier: VerifierId): string {
  return verifierLabels[verifier];
}

export function loopPhaseProgress(loop: LoopWithPhases): { passed: number; total: number } {
  return {
    passed: loop.phases.filter((phase) => phase.status === 'passed').length,
    total: loop.phases.length,
  };
}

export function statusToneClass(tone: StatusTone): string {
  switch (tone) {
    case 'info':
      return 'border-primary/20 bg-primary/10 text-primary';
    case 'warning':
      return 'border-foreground-warning/20 bg-background-warning text-foreground-warning';
    case 'success':
      return 'border-foreground-success/20 bg-background-success text-foreground-success';
    case 'danger':
      return 'border-foreground-destructive/20 bg-background-destructive text-foreground-destructive';
    case 'neutral':
      return 'border-border bg-background-2 text-foreground-muted';
  }
}

export function statusDotClass(tone: StatusTone): string {
  switch (tone) {
    case 'info':
      return 'bg-primary';
    case 'warning':
      return 'bg-foreground-warning';
    case 'success':
      return 'bg-foreground-success';
    case 'danger':
      return 'bg-foreground-destructive';
    case 'neutral':
      return 'bg-foreground-passive';
  }
}

function stringProperty(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberProperty(record: Record<string, unknown>, key: string): number | null | undefined {
  const value = record[key];
  if (typeof value === 'number') return value;
  if (value === null) return null;
  return undefined;
}

export function parseVerifierEvidence(evidence: string | undefined): ParsedVerifierEvidence | null {
  if (!evidence?.trim()) return null;

  try {
    const parsed = JSON.parse(evidence) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { summary: evidence };
    }
    const record = parsed as Record<string, unknown>;
    const stdoutTail = stringProperty(record, 'stdoutTail');
    const stderrTail = stringProperty(record, 'stderrTail');
    return {
      summary:
        stringProperty(record, 'summary') ??
        stringProperty(record, 'message') ??
        stdoutTail ??
        stderrTail,
      command: stringProperty(record, 'command'),
      stdoutTail,
      stderrTail,
      evidencePath: stringProperty(record, 'evidencePath'),
      exitCode: numberProperty(record, 'exitCode'),
      durationMs: numberProperty(record, 'durationMs') ?? undefined,
    };
  } catch {
    return { summary: evidence };
  }
}
