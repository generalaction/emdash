import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok } from '@main/lib/result';
import { checkCliAvailability, errorFromExec, evidenceFromExec } from './common';
import { runExecFile, type ExecFileFailure } from './exec';
import type { LoopVerifier } from './types';

const id = 'agent-browser' as const;
const label = 'Agent Browser';

function criterionText(criteria: { description: string }[]): string {
  return criteria.map((criterion, idx) => `${idx + 1}. ${criterion.description}`).join('\n');
}

export const agentBrowserVerifier: LoopVerifier = {
  id,
  label,

  checkAvailability(cwd) {
    return checkCliAvailability(id, 'agent-browser', ['--version'], cwd);
  },

  async run(ctx) {
    const agentBrowser = ctx.loop.config?.agentBrowser;
    const targetUrl = agentBrowser?.targetUrl?.trim();
    const cdpPort = agentBrowser?.cdpPort;
    if (!targetUrl && !cdpPort) {
      return err({
        kind: 'invalid-config',
        verifierId: id,
        message: 'agent-browser requires loop.config.agentBrowser.targetUrl or cdpPort',
        cwd: ctx.cwd,
      });
    }

    const criteria = ctx.criteria.filter((criterion) => criterion.verifier === id);
    const criterion = criterionText(criteria);
    if (!criterion) {
      return err({
        kind: 'invalid-config',
        verifierId: id,
        message: 'agent-browser has no phase criteria to verify',
        cwd: ctx.cwd,
      });
    }

    const evidenceDir = join(ctx.cwd, '.emdash-loops-evidence', ctx.loop.id, ctx.phase.id);
    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, `attempt-${ctx.phase.attempts}.json`);
    const args = [
      'verify',
      '--criterion',
      criterion,
      '--output-dir',
      evidenceDir,
      ...(targetUrl ? ['--url', targetUrl] : []),
      ...(cdpPort ? ['--cdp-port', String(cdpPort)] : []),
    ];

    try {
      const result = await runExecFile('agent-browser', args, {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeoutMs: 5 * 60_000,
      });
      await writeFile(
        evidencePath,
        `${JSON.stringify(
          {
            loopId: ctx.loop.id,
            phaseId: ctx.phase.id,
            targetUrl,
            cdpPort,
            criteria,
            stdoutTail: result.stdoutTail,
            stderrTail: result.stderrTail,
            completedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`
      );
      return ok(
        evidenceFromExec(id, label, result, 'agent-browser criteria passed.', evidencePath)
      );
    } catch (failure) {
      return err({
        ...errorFromExec(id, failure as ExecFileFailure, 'agent-browser verification failed'),
        evidencePath,
      });
    }
  },
};
