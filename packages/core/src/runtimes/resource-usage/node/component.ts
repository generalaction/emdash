import { createController } from '@emdash/wire';
import { defineWireComponent } from '@emdash/wire/component';
import { resourceUsageContract } from '@runtimes/resource-usage/api';
import { z } from 'zod';
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
