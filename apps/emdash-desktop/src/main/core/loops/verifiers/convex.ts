import { err, ok } from '@main/lib/result';
import { checkCliAvailability, errorFromExec, evidenceFromExec } from './common';
import { runExecFile, type ExecFileFailure } from './exec';
import type { LoopVerifier } from './types';

const id = 'convex' as const;
const label = 'Convex dry run';

export const convexVerifier: LoopVerifier = {
  id,
  label,

  checkAvailability(cwd) {
    return checkCliAvailability(id, 'npx', ['convex', '--version'], cwd);
  },

  async run(ctx) {
    try {
      const result = await runExecFile('npx', ['convex', 'deploy', '--dry-run'], {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeoutMs: 5 * 60_000,
      });
      return ok(evidenceFromExec(id, label, result, 'Convex dry run passed.'));
    } catch (failure) {
      return err(errorFromExec(id, failure as ExecFileFailure, 'Convex dry run failed'));
    }
  },
};
