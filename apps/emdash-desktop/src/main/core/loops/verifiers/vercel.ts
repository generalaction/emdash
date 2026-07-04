import { err, ok } from '@main/lib/result';
import { checkCliAvailability, errorFromExec, evidenceFromExec, jsonSummary } from './common';
import { runExecFile, type ExecFileFailure } from './exec';
import type { LoopVerifier } from './types';

const id = 'vercel' as const;
const label = 'Vercel deployment';

function latestDeploymentIsReady(raw: string): { ready: boolean; summary: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ready: true, summary: raw.trim() || 'Vercel command completed.' };
  }

  const deployments = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { deployments?: unknown[] }).deployments)
      ? (parsed as { deployments: unknown[] }).deployments
      : [];

  const latest = deployments[0];
  if (!latest || typeof latest !== 'object') {
    return { ready: false, summary: 'No Vercel deployments were found.' };
  }

  const record = latest as Record<string, unknown>;
  const state = String(record.state ?? record.readyState ?? record.status ?? '').toUpperCase();
  const ready = ['READY', 'SUCCESS', 'DEPLOYED'].includes(state);
  return {
    ready,
    summary: ready ? 'Latest Vercel deployment is ready.' : `Latest Vercel deployment: ${state}`,
  };
}

export const vercelVerifier: LoopVerifier = {
  id,
  label,

  checkAvailability(cwd) {
    return checkCliAvailability(id, 'vercel', ['--version'], cwd);
  },

  async run(ctx) {
    try {
      const result = await runExecFile('vercel', ['ls', '--json'], {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeoutMs: 120_000,
      });
      const deployment = latestDeploymentIsReady(result.stdoutTail);
      if (!deployment.ready) {
        return err({
          kind: 'command-failed',
          verifierId: id,
          message: deployment.summary,
          command: result.command,
          cwd: ctx.cwd,
          durationMs: result.durationMs,
          stdoutTail: jsonSummary(result.stdoutTail),
          stderrTail: result.stderrTail,
          exitCode: result.exitCode,
        });
      }
      return ok(evidenceFromExec(id, label, result, deployment.summary));
    } catch (failure) {
      return err(errorFromExec(id, failure as ExecFileFailure, 'Vercel verification failed'));
    }
  },
};
