import type { Result } from '@main/lib/result';
import type { Loop, LoopPhase, LoopPhaseCriterion, VerifierId } from '@shared/core/loops/loops';

export type BuiltInVerifierId = 'unit-tests' | VerifierId;

export type VerifierAvailability = {
  available: boolean;
  message?: string;
};

export type VerifierEvidence = {
  verifierId: BuiltInVerifierId;
  label: string;
  command: string;
  cwd: string;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number;
  summary: string;
  evidencePath?: string;
};

export type VerifierError = {
  kind:
    | 'unavailable'
    | 'invalid-config'
    | 'command-failed'
    | 'timed-out'
    | 'aborted'
    | 'execution-error';
  verifierId: BuiltInVerifierId;
  message: string;
  command?: string;
  cwd?: string;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  exitCode?: number | null;
  evidencePath?: string;
};

export type VerifierRunContext = {
  loop: Loop;
  phase: LoopPhase;
  cwd: string;
  validationCommands: string[];
  criteria: LoopPhaseCriterion[];
  signal?: AbortSignal;
};

export type LoopVerifier = {
  id: BuiltInVerifierId;
  label: string;
  checkAvailability(cwd: string): Promise<Result<VerifierAvailability, VerifierError>>;
  run(ctx: VerifierRunContext): Promise<Result<VerifierEvidence, VerifierError>>;
};
