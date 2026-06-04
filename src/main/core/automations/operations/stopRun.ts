import { getRun } from '../repo';
import { markRunFailed, markRunSkipped } from '../run-transitions';

export async function stopRun(runId: string) {
  const run = await getRun(runId);
  if (!run) throw new Error('run_not_found');
  if (run.status === 'queued') return markRunSkipped(runId, 'manually_stopped');
  if (run.status === 'running') return markRunFailed(runId, { error: 'manually_stopped' });
  throw new Error('run_not_stoppable');
}
