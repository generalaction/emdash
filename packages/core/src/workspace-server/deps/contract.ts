import { defineContract, fallible, procedure } from '@emdash/wire';
import { z } from 'zod';
import {
  dependencyInstallErrorSchema,
  dependencyStateSchema,
  dependencyUninstallErrorSchema,
  depsInstallStrategySchema,
  depsUninstallStrategySchema,
  probeResponseSchema,
  wireDependencyDescriptorSchema,
} from './schemas';

export const depsContract = defineContract({
  probe: procedure({
    input:
      z.object({
        descriptor: wireDependencyDescriptorSchema,
        /** When true the server refreshes the shell environment before probing. */
        refreshShellEnv: z.boolean().optional(),
      }),
    output: probeResponseSchema,
  }),
  install: fallible({
    input:
      z.object({
        descriptor: wireDependencyDescriptorSchema,
        strategy: depsInstallStrategySchema,
      }),
    data: dependencyStateSchema,
    error: dependencyInstallErrorSchema,
  }),
  uninstall: fallible({
    input:
      z.object({
        descriptor: wireDependencyDescriptorSchema,
        strategy: depsUninstallStrategySchema,
      }),
    data: dependencyStateSchema,
    error: dependencyUninstallErrorSchema,
  }),
});

export type DepsContract = typeof depsContract;
