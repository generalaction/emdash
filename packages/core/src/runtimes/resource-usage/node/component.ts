import { createController } from '@emdash/wire/rpc';
import { defineWireComponent } from '@emdash/wire/worker';
import { z } from 'zod';
import { resourceUsageContract } from '#runtimes/resource-usage/api';
import { ResourceUsageRuntime } from './resource-usage-runtime';

export const resourceUsageComponent = defineWireComponent({
  id: 'resource-usage',
  contract: resourceUsageContract,
  requirements: {},
  configSchema: z.object({}),
  create: ({ instance, scope }) => {
    const runtime = new ResourceUsageRuntime();
    return instance({
      scope,
      controller: createController(resourceUsageContract, {
        sample: () => runtime.sample(),
      }),
    });
  },
});
