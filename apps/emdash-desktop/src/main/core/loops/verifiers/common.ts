import { err, ok, type Result } from '@main/lib/result';
import { runExecFile, type ExecFileFailure, type ExecFileResult } from './exec';
import type {
  BuiltInVerifierId,
  VerifierAvailability,
  VerifierError,
  VerifierEvidence,
} from './types';

function nonEmptySummary(result: ExecFileResult, summary: string, label: string): string {
  return (
    [summary, result.stdoutTail, result.stderrTail]
      .map((value) => value.trim())
      .find((value) => value.length > 0) ?? `${label} passed.`
  );
}

export function evidenceFromExec(
  verifierId: BuiltInVerifierId,
  label: string,
  result: ExecFileResult,
  summary: string,
  evidencePath?: string
): VerifierEvidence {
  return {
    verifierId,
    label,
    command: result.command,
    cwd: result.cwd,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
    exitCode: result.exitCode,
    summary: nonEmptySummary(result, summary, label),
    ...(evidencePath ? { evidencePath } : {}),
  };
}

export function errorFromExec(
  verifierId: BuiltInVerifierId,
  failure: ExecFileFailure,
  fallbackMessage: string
): VerifierError {
  return {
    kind: failure.aborted ? 'aborted' : failure.timedOut ? 'timed-out' : 'command-failed',
    verifierId,
    message: failure.stderrTail.trim() || failure.stdoutTail.trim() || fallbackMessage,
    command: failure.command,
    cwd: failure.cwd,
    durationMs: failure.durationMs,
    stdoutTail: failure.stdoutTail,
    stderrTail: failure.stderrTail,
    exitCode: failure.exitCode,
  };
}

export async function checkCliAvailability(
  verifierId: BuiltInVerifierId,
  file: string,
  args: string[],
  cwd: string
): Promise<Result<VerifierAvailability, VerifierError>> {
  try {
    await runExecFile(file, args, { cwd, timeoutMs: 15_000 });
    return ok({ available: true });
  } catch (failure) {
    return err({
      ...errorFromExec(verifierId, failure as ExecFileFailure, `${file} is not available`),
      kind: 'unavailable',
      message: `${file} is not available`,
    });
  }
}

export function jsonSummary(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
