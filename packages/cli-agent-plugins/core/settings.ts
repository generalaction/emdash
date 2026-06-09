import z from 'zod';

export const agentUserSettingsSchema = z.object({
  customBinaryPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

type AgentUserSettings = z.infer<typeof agentUserSettingsSchema>;
