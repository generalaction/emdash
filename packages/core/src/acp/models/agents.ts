import { z } from 'zod';
import { toolStatusSchema } from './tools';

export const subagentStateSchema = z.object({
  /** Provider/runtime id for the spawned agent; stable across later status notifications. */
  agentId: z.string(),
  /** Tool call that launched or represents this agent in the transcript. */
  toolCallId: z.string(),
  /** Turn that launched the agent; null only for orphan updates whose launch was never observed. */
  launchTurnId: z.string().nullable(),
  name: z.string(),
  status: toolStatusSchema,
  /** Epoch ms when the runtime first observed this agent. */
  startedAt: z.number(),
  /** Epoch ms when the agent reached a terminal status. Absent while running. */
  completedAt: z.number().optional(),
  /** True for Claude-style async/background agents that can outlive their launch turn. */
  background: z.boolean().optional(),
  /** Provider-managed file containing background-agent output, when available. */
  outputFile: z.string().optional(),
  /** Provider-supplied completion summary for background-agent updates. */
  summary: z.string().optional(),
});

export type SubagentState = z.infer<typeof subagentStateSchema>;
