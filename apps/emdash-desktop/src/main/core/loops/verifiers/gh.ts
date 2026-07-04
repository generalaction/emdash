import { err, ok } from '@main/lib/result';
import { checkCliAvailability, errorFromExec, evidenceFromExec, jsonSummary } from './common';
import { runExecFile, type ExecFileFailure } from './exec';
import type { LoopVerifier } from './types';

const id = 'gh' as const;
const label = 'GitHub checks';

function checksAreGreen(raw: string): { green: boolean; summary: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { green: raw.trim().length > 0, summary: raw.trim() || 'gh command completed.' };
  }

  if (!Array.isArray(parsed)) {
    return { green: true, summary: jsonSummary(parsed) };
  }

  if (parsed.length === 0) {
    return { green: false, summary: 'No GitHub checks or workflow runs were found.' };
  }

  const failing = parsed.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true;
    const record = entry as Record<string, unknown>;
    const state = String(record.state ?? record.status ?? '').toLowerCase();
    const conclusion = String(record.conclusion ?? '').toLowerCase();
    if (state && !['success', 'completed', 'pass', 'passing'].includes(state)) return true;
    if (conclusion && !['success', 'skipped', 'neutral'].includes(conclusion)) return true;
    return false;
  });

  return {
    green: failing.length === 0,
    summary:
      failing.length === 0 ? 'GitHub checks are green.' : `Failing checks: ${jsonSummary(failing)}`,
  };
}

export const ghVerifier: LoopVerifier = {
  id,
  label,

  checkAvailability(cwd) {
    return checkCliAvailability(id, 'gh', ['--version'], cwd);
  },

  async run(ctx) {
    try {
      const result = await runExecFile(
        'gh',
        ['pr', 'checks', '--json', 'name,state,conclusion,link'],
        {
          cwd: ctx.cwd,
          signal: ctx.signal,
          timeoutMs: 120_000,
        }
      );
      const checks = checksAreGreen(result.stdoutTail);
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
    } catch {
      // Some branches do not have an associated PR yet; fall back to the latest workflow run.
    }

    try {
      const result = await runExecFile(
        'gh',
        ['run', 'list', '--limit', '1', '--json', 'status,conclusion,name,databaseId,url'],
        {
          cwd: ctx.cwd,
          signal: ctx.signal,
          timeoutMs: 120_000,
        }
      );
      const checks = checksAreGreen(result.stdoutTail);
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
