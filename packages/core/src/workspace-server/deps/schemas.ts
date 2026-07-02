import { z } from 'zod';
import {
  INSTALL_METHODS,
  PLATFORMS,
  installOptionSchema,
  uninstallStrategySchema,
  updatesDescriptorSchema,
} from '../../host-dependencies/capability';
import { result } from '../shared/schemas';

export const dependencyCategorySchema = z.enum(['core', 'agent']);

export const dependencyStatusSchema = z.enum(['available', 'missing', 'error']);

export const dependencyStateSchema = z.object({
  id: z.string(),
  category: dependencyCategorySchema,
  status: dependencyStatusSchema,
  version: z.string().nullable(),
  path: z.string().nullable(),
  checkedAt: z.number(),
  error: z.string().optional(),
  latestVersion: z.string().nullable().optional(),
  updateAvailable: z.boolean().optional(),
});

export const installCommandErrorSchema = z.union([
  z.object({
    type: z.literal('permission-denied'),
    message: z.string(),
    output: z.string(),
    exitCode: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('command-failed'),
    message: z.string(),
    output: z.string(),
    exitCode: z.number().int().optional(),
  }),
  z.object({ type: z.literal('pty-open-failed'), message: z.string() }),
]);

export const dependencyInstallErrorSchema = z.union([
  z.object({ type: z.literal('unknown-dependency'), id: z.string() }),
  z.object({ type: z.literal('no-install-command'), id: z.string() }),
  installCommandErrorSchema,
  z.object({ type: z.literal('not-detected-after-install'), id: z.string() }),
]);

export const dependencyUninstallErrorSchema = z.union([
  z.object({ type: z.literal('unknown-dependency'), id: z.string() }),
  z.object({ type: z.literal('no-uninstall-strategy'), id: z.string() }),
  z.object({ type: z.literal('no-uninstall-command'), id: z.string() }),
  z.object({ type: z.literal('still-present'), id: z.string() }),
  installCommandErrorSchema,
]);

export const dependencyInstallResultSchema = result(
  dependencyStateSchema,
  dependencyInstallErrorSchema
);
export const dependencyUninstallResultSchema = result(
  dependencyStateSchema,
  dependencyUninstallErrorSchema
);

export const wireDependencyDescriptorSchema = z.object({
  id: z.string(),
  category: dependencyCategorySchema,
  /** Binary names to try in order; first success wins. */
  commands: z.array(z.string()),
  versionArgs: z.array(z.string()).optional(),
  skipVersionProbe: z.boolean().optional(),
  installCommands: z.partialRecord(z.enum(PLATFORMS), z.array(installOptionSchema)).optional(),
  updates: updatesDescriptorSchema.optional(),
  uninstall: uninstallStrategySchema.optional(),
});

export const probeResultSchema = z.object({
  command: z.string(),
  path: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
});

export const probeResponseSchema = z.object({
  state: dependencyStateSchema,
  /**
   * Raw probe output. Null when the probe was skipped (skipVersionProbe, missing
   * binary on path phase 1) and only path-resolution state is available.
   */
  probeResult: probeResultSchema.nullable(),
});

export const depsInstallStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('package-manager'), method: z.enum(INSTALL_METHODS).optional() }),
  z.object({ kind: z.literal('custom'), command: z.string() }),
]);

export const depsUninstallStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('package-manager'), method: z.enum(INSTALL_METHODS).optional() }),
  z.object({ kind: z.literal('custom'), command: z.string() }),
]);
