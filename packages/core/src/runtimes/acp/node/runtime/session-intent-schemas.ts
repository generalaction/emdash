import { z } from 'zod';
import {
  sessionConfigStateSchema,
  sessionMcpServerSchema,
  sessionUsageSchema,
} from '#runtimes/acp/api';

const retainedConfiguredSchema = z.object({
  options: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

const retainedPresentationSchema = z.object({
  configured: retainedConfiguredSchema,
  lastKnownCapabilities: sessionConfigStateSchema,
  lastKnownMcpServers: z.array(sessionMcpServerSchema),
  lastKnownUsage: sessionUsageSchema.nullable(),
  observedAt: z.number().int().nullable(),
});

export const persistedIntentV1Schema = z.object({
  version: z.literal('1'),
  conversationId: z.string(),
  providerId: z.string(),
  cwd: z.string(),
  sessionId: z.string().nullable(),
  unstarted: z.boolean().optional(),
  initialQueueConsumed: z.boolean().optional(),
  configured: retainedConfiguredSchema,
  presentation: retainedPresentationSchema,
});
