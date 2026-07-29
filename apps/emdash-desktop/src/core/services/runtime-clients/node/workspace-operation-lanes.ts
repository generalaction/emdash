import { resourceKeyFromFileRef, type HostFileRef } from '@emdash/core/primitives/path/api';
import { createKeyedLanes } from '@emdash/shared/concurrency';

const lanes = createKeyedLanes();

export async function runInWorkspaceOperationLane<T>(
  workspace: HostFileRef,
  signal: AbortSignal,
  run: () => Promise<T>,
  options: { onWaitingChange?: (waiting: boolean) => void } = {}
): Promise<T> {
  const key = resourceKeyFromFileRef(workspace);
  const shouldReportWaiting = lanes.depth(key) > 0;
  if (shouldReportWaiting) options.onWaitingChange?.(true);
  try {
    return await lanes.run(key, signal, async () => {
      if (shouldReportWaiting) options.onWaitingChange?.(false);
      return await run();
    });
  } finally {
    if (shouldReportWaiting) options.onWaitingChange?.(false);
  }
}
