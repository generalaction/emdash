import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';

export const PLATFORMS = ['macos', 'windows', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type DependencyStatus = 'available' | 'missing' | 'error';

export interface ProbeResult {
  command: string;
  path: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export const hostDependencyUpdateCommandSchema = z.object({
  kind: z.literal('self'),
  args: z.array(z.string()),
});
export type HostDependencyUpdateCommand = z.output<typeof hostDependencyUpdateCommandSchema>;

export const hostDependencyDescriptorSchema = z
  .object({
    id: z.string(),
    /** Binary names to try in order; first success wins. */
    binaryNames: z.array(z.string()).min(1),
    installDocs: z.string().optional(),
    /** Optional self-update command run as the selected executable plus these argv tokens. */
    updateCommand: hostDependencyUpdateCommandSchema.optional(),
  })
  .passthrough();
export type HostDependencyDescriptor = z.output<typeof hostDependencyDescriptorSchema>;

export type IHostDependencyBehavior = {
  /**
   * Override the default status resolution logic.
   * Useful for CLIs that exit non-zero on `--version` but are still available.
   */
  resolveStatus?(result: ProbeResult): DependencyStatus;
};

export const hostDependencyCapability = definePluginCapability<IHostDependencyBehavior>()(
  'host-dependency',
  hostDependencyDescriptorSchema
);
