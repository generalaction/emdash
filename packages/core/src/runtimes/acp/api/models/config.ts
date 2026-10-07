import { z } from 'zod';

/** Provider-owned configuration; ids are opaque and never inferred from labels. */
export const providerOptionValueSchema = z.union([z.string(), z.boolean()]);
export const providerOptionValuesSchema = z.record(z.string(), providerOptionValueSchema);
export type ProviderOptionValues = z.infer<typeof providerOptionValuesSchema>;
const providerChoiceSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().nullish(),
});
const providerGroupSchema = z.object({
  group: z.string(),
  name: z.string(),
  options: z.array(providerChoiceSchema),
});
const providerOptionBase = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
});
export const providerConfigOptionSchema = z.discriminatedUnion('type', [
  providerOptionBase.extend({
    type: z.literal('select'),
    currentValue: z.string(),
    options: z.union([z.array(providerChoiceSchema), z.array(providerGroupSchema)]),
  }),
  providerOptionBase.extend({ type: z.literal('boolean'), currentValue: z.boolean() }),
]);
export type ProviderConfigOption = z.infer<typeof providerConfigOptionSchema>;
export function providerChoices(option: ProviderConfigOption) {
  return option.type === 'select'
    ? option.options.flatMap((item) => ('group' in item ? item.options : [item]))
    : [];
}
export function acceptsProviderValue(
  option: ProviderConfigOption,
  value: string | boolean
): boolean {
  return option.type === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && providerChoices(option).some((choice) => choice.value === value);
}

export const sessionCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Distinguishes provider-advertised ACP commands from Emdash-owned skills. */
  source: z.literal('provider-command'),
  /** Optional provider hint for slash-command arguments, shown near the composer. */
  inputHint: z.string().optional(),
});
export type SessionCommand = z.infer<typeof sessionCommandSchema>;

export const sessionMcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'sse']).optional(),
  startupError: z.string().optional(),
});
export type SessionMcpServer = z.infer<typeof sessionMcpServerSchema>;

export const sessionConfigStateSchema = z.object({
  options: z.array(providerConfigOptionSchema).optional(),
  configuredOptions: providerOptionValuesSchema.optional(),
  discoveryContext: z.string().optional(),
  clearedOptions: providerOptionValuesSchema.optional(),
  /** Slash commands currently advertised by the active ACP session. */
  availableCommands: z.array(sessionCommandSchema),
});
export type SessionConfigState = z.infer<typeof sessionConfigStateSchema>;

export const initialSessionConfigState: SessionConfigState = {
  availableCommands: [],
};

export const sessionUsageSchema = z.object({
  /** Total context window capacity reported by the provider. */
  contextSize: z.number().int(),
  /** Tokens currently consumed in the active session context. */
  contextUsed: z.number().int(),
  /** Cumulative provider-reported cost, or null when the provider omits cost. */
  cost: z.object({ amount: z.number(), currency: z.string() }).nullable(),
});
export type SessionUsage = z.infer<typeof sessionUsageSchema>;
