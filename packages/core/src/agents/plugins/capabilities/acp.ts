import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';

export type AcpSpawnContext = {
  /** Absolute path to the worktree / task directory. */
  cwd: string;
  /** Environment variables to pass to the spawned process. */
  env: Record<string, string>;
};

export type AcpSpawnResult = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type IAcpBehavior = {
  /** Build the spawn command for the ACP adapter subprocess. */
  buildSpawn(ctx: AcpSpawnContext): AcpSpawnResult;
};

/**
 * Describes whether a provider supports the Agent Client Protocol (ACP) transport
 * in addition to (or instead of) the PTY terminal transport.
 */
export const acpCapability = definePluginCapability<IAcpBehavior>()(
  'acp',
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('supported') }),
  ])
);
