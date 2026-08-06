import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

export const devPerfProcessSchema = z.object({
  pid: z.number(),
  ppid: z.number(),
  /** Depth in the tree rooted at the main process (0 = main). */
  depth: z.number(),
  cpuPercent: z.number(),
  rssBytes: z.number(),
  command: z.string(),
});

export type DevPerfProcess = z.infer<typeof devPerfProcessSchema>;

export const devPerfContract = defineContract({
  /**
   * One `ps` snapshot of the app's process tree (main + all descendants,
   * including spawned grandchildren like git). Poll-driven: the main process
   * runs `ps` only when asked, so polling cost exists exactly while a panel
   * polls.
   */
  processSnapshot: procedure({
    input: z.void(),
    output: z.object({
      supported: z.boolean(),
      processes: z.array(devPerfProcessSchema),
    }),
  }),
  /** Capture a contentTracing trace and return the file it was written to. */
  captureTrace: procedure({
    input: z.object({ durationMs: z.number().optional() }),
    output: z.object({ path: z.string() }),
  }),
  /** Toggle verbose per-spawn logging (main process + all workers). */
  setVerboseSpawnLogging: procedure({
    input: z.object({ enabled: z.boolean() }),
    output: z.object({ enabled: z.boolean() }),
  }),
  getVerboseSpawnLogging: procedure({
    input: z.void(),
    output: z.object({ enabled: z.boolean() }),
  }),
});
