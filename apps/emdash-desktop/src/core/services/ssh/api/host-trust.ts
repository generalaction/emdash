import { z } from 'zod';

export const hostTrustPromptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unknown'), destination: z.string(), prompt: z.string() }),
  z.object({
    kind: z.literal('changed'),
    destination: z.string(),
    host: z.string(),
    knownHostsFile: z.string(),
    previousFingerprints: z.array(z.string()),
    fingerprint: z.string(),
  }),
]);
export const hostTrustRequestSchema = z.object({ id: z.string(), prompt: hostTrustPromptSchema });
export type HostTrustPrompt = z.infer<typeof hostTrustPromptSchema>;
export type HostTrustRequest = z.infer<typeof hostTrustRequestSchema>;
