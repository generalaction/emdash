import type { Scope } from '@emdash/shared/concurrency';
import { createController, type Controller } from '@emdash/wire/rpc';
import { expose } from '@emdash/wire/state';
import { usageContract } from '../api/contract';
import type { UsageOverviewSource } from './usage-overview';

export function createUsageWireController(options: {
  scope: Scope;
  usage: UsageOverviewSource;
}): Controller {
  const overview = expose(
    usageContract.overview,
    { current: (_key, owner) => options.usage.observe(owner) },
    { scope: options.scope, lingerMs: 0 }
  );

  return createController(usageContract, {
    overview,
    refresh: () => options.usage.refresh(),
  });
}
