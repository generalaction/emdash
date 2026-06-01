import type { UsageSnapshot } from '@shared/usage';
import { usageStatsService } from './usage-stats-service';

export function getUsageSnapshot(): Promise<UsageSnapshot> {
  return usageStatsService.getSnapshot();
}

export function refreshUsage(): Promise<UsageSnapshot> {
  return usageStatsService.refresh();
}
