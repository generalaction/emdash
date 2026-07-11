import { err, ok } from '@main/lib/result';
import { checkCliAvailability, errorFromExec, evidenceFromExec, jsonSummary } from './common';
import { OUTPUT_TAIL_MAX, runExecFile, type ExecFileFailure } from './exec';
import type { LoopVerifier } from './types';

const id = 'gh' as const;
const label = 'GitHub checks';

function checksAreGreen(raw: string): { green: boolean; summary: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { green: false, summary: 'GitHub checks returned malformed JSON.' };
  }

  if (!Array.isArray(parsed)) {
    return { green: false, summary: 'GitHub checks returned an unexpected JSON value.' };
  }

  if (parsed.length === 0) {
    return { green: false, summary: 'No GitHub checks or workflow runs were found.' };
  }

  const failing = parsed.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true;
    const record = entry as Record<string, unknown>;
    const bucket = String(record.bucket ?? '').toLowerCase();
    const state = String(record.state ?? record.status ?? '').toLowerCase();
    const conclusion = String(record.conclusion ?? '').toLowerCase();

    if (bucket) return !['pass', 'skipping'].includes(bucket);
    if (
      !state ||
      !['success', 'completed', 'pass', 'passing', 'neutral', 'skipped'].includes(state)
    ) {
      return true;
    }
    if (conclusion && !['success', 'skipped', 'neutral'].includes(conclusion)) return true;
    return false;
  });

  const failingSummary = `Failing checks: ${jsonSummary(failing)}`.slice(0, OUTPUT_TAIL_MAX);

  return {
    green: failing.length === 0,
    summary: failing.length === 0 ? 'GitHub checks are green.' : failingSummary,
  };
}

function isMissingPullRequest(failure: ExecFileFailure): boolean {
  const output = [failure.message, failure.stderrTail, failure.stdoutTail].join('\n');
  return /(?:no pull requests? found for branch|could not find (?:a )?pull request for branch)/i.test(
    output
  );
}

export const ghVerifier: LoopVerifier = {
  id,
  label,

  checkAvailability(cwd, executionTarget) {
    return checkCliAvailability(id, 'gh', ['--version'], cwd, executionTarget);
  },

  async run(ctx) {
    try {
      const result = await runExecFile('gh', ['pr', 'checks', '--json', 'name,state,bucket,link'], {
        cwd: ctx.cwd,
        executionTarget: ctx.executionTarget,
        signal: ctx.signal,
        timeoutMs: 120_000,
      });
      const checks = checksAreGreen(result.stdout);
      if (!checks.green) {
        return err({
          kind: 'command-failed',
          verifierId: id,
          message: checks.summary,
          command: result.command,
          cwd: ctx.cwd,
          durationMs: result.durationMs,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          exitCode: result.exitCode,
        });
      }
      return ok(evidenceFromExec(id, label, result, checks.summary));
    } catch (failure) {
      const firstFailure = errorFromExec(
        id,
        failure as ExecFileFailure,
        'GitHub pull request checks failed'
      );
      if (firstFailure.kind === 'aborted' || firstFailure.kind === 'timed-out') {
        return err(firstFailure);
      }
      if (!isMissingPullRequest(failure as ExecFileFailure)) return err(firstFailure);
    }

    let branch: string;
    try {
      const result = await runExecFile('git', ['branch', '--show-current'], {
        cwd: ctx.cwd,
        executionTarget: ctx.executionTarget,
        signal: ctx.signal,
        timeoutMs: 15_000,
      });
      branch = result.stdout.trim();
      if (!branch) {
        return err({
          kind: 'command-failed',
          verifierId: id,
          message: 'No pull request exists and the current branch could not be determined.',
          command: result.command,
          cwd: ctx.cwd,
          durationMs: result.durationMs,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          exitCode: result.exitCode,
        });
      }
    } catch (failure) {
      return err(
        errorFromExec(id, failure as ExecFileFailure, 'Could not determine the current branch')
      );
    }

    try {
      const result = await runExecFile(
        'gh',
        [
          'run',
          'list',
          '--branch',
          branch,
          '--limit',
          '1',
          '--json',
          'status,conclusion,name,databaseId,url',
        ],
        {
          cwd: ctx.cwd,
          executionTarget: ctx.executionTarget,
          signal: ctx.signal,
          timeoutMs: 120_000,
        }
      );
      const checks = checksAreGreen(result.stdout);
      if (!checks.green) {
        return err({
          kind: 'command-failed',
          verifierId: id,
          message: checks.summary,
          command: result.command,
          cwd: ctx.cwd,
          durationMs: result.durationMs,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
          exitCode: result.exitCode,
        });
      }
      return ok(evidenceFromExec(id, label, result, checks.summary));
    } catch (failure) {
      return err(errorFromExec(id, failure as ExecFileFailure, 'GitHub checks failed'));
    }
  },
};
