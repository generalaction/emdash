import { z } from 'zod';

const configOptionBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const modelOptionSchema = configOptionBaseSchema.extend({
  /** Optional model metadata used for ranking/display; absent when provider does not report it. */
  features: z
    .object({
      contextWindowSize: z.number().int().optional(),
      speed: z.number().int().optional(),
      intelligence: z.number().int().optional(),
    })
    .optional(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;
export type ModelChoice = ModelOption;

export const effortOptionSchema = configOptionBaseSchema;
export type EffortOption = z.infer<typeof effortOptionSchema>;

export const modeOptionSchema = configOptionBaseSchema;
export type ModeOption = z.infer<typeof modeOptionSchema>;

export const sessionCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Optional provider hint for slash-command arguments, shown near the composer. */
  inputHint: z.string().optional(),
});
export type SessionCommand = z.infer<typeof sessionCommandSchema>;

export const sessionConfigStateSchema = z.object({
  /** Model selector state; null when the provider has not exposed model configuration. */
  modelOptions: z
    .object({
      selected: z.string().nullable(),
      available: z.array(modelOptionSchema),
    })
    .nullable(),
  /** Reasoning/effort selector state; null when unsupported by the provider. */
  efforts: z
    .object({
      selected: z.string().nullable(),
      available: z.array(effortOptionSchema),
    })
    .nullable(),
  /** Permission/mode selector state; null when unsupported by the provider. */
  modeOptions: z
    .object({
      selected: z.string().nullable(),
      available: z.array(modeOptionSchema),
    })
    .nullable(),
  /** Slash commands currently advertised by the active ACP session. */
  availableCommands: z.array(sessionCommandSchema),
});
export type SessionConfigState = z.infer<typeof sessionConfigStateSchema>;

export function emptyConfig(): SessionConfigState {
  return {
    modelOptions: null,
    efforts: null,
    modeOptions: null,
    availableCommands: [],
  };
}

export const sessionUsageSchema = z.object({
  /** Total context window capacity reported by the provider. */
  contextSize: z.number().int(),
  /** Tokens currently consumed in the active session context. */
  contextUsed: z.number().int(),
  /** Cumulative provider-reported cost, or null when the provider omits cost. */
  cost: z.object({ amount: z.number(), currency: z.string() }).nullable(),
});
export type SessionUsage = z.infer<typeof sessionUsageSchema>;
