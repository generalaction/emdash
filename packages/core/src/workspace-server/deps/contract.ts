import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  dependencyInstallResultSchema,
  dependencyUninstallResultSchema,
  depsInstallStrategySchema,
  depsUninstallStrategySchema,
  probeResponseSchema,
  wireDependencyDescriptorSchema,
} from './schemas';

export const depsContract = {
  probe: oc
    .input(
      z.object({
        descriptor: wireDependencyDescriptorSchema,
        /** When true the server refreshes the shell environment before probing. */
        refreshShellEnv: z.boolean().optional(),
      })
    )
    .output(probeResponseSchema),
  install: oc
    .input(
      z.object({
        descriptor: wireDependencyDescriptorSchema,
        strategy: depsInstallStrategySchema,
      })
    )
    .output(dependencyInstallResultSchema),
  uninstall: oc
    .input(
      z.object({
        descriptor: wireDependencyDescriptorSchema,
        strategy: depsUninstallStrategySchema,
      })
    )
    .output(dependencyUninstallResultSchema),
};

export type DepsContract = typeof depsContract;
