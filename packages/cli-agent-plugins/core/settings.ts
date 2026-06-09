import { z } from 'zod';

export const agentUserSettingsSchema = z.object({
  customBinaryPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type AgentUserSettings = z.infer<typeof agentUserSettingsSchema>;

export type SettingsFieldType =
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'select'; options: { value: string; label: string }[] }
  | { kind: 'string-array' };

export type CustomSettingField = {
  key: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  default?: unknown;
};

export type SettingsDescriptor = { custom?: CustomSettingField[] } | { kind: 'none' };
