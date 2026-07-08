import { z } from 'zod';

export const wireInitializeInputSchema = z.object({
  protocolVersion: z.string(),
});

export const wireServerInfoSchema = z.object({
  appVersion: z.string(),
  daemonId: z.string(),
  startedAt: z.number(),
});

export const wireInitializeResultSchema = z.object({
  protocolVersion: z.string(),
  agreedVersion: z.string(),
  agreedMinor: z.number(),
  server: wireServerInfoSchema,
});

export const wireProtocolIncompatibleSchema = z.object({
  code: z.literal('protocol-incompatible'),
  action: z.enum(['upgrade-client', 'upgrade-server']),
  clientProtocolVersion: z.string(),
  serverProtocolVersion: z.string(),
});

export const wireHealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeMs: z.number(),
  protocolVersion: z.string(),
});

export type WireInitializeInput = z.infer<typeof wireInitializeInputSchema>;
export type WireInitializeResult = z.infer<typeof wireInitializeResultSchema>;
export type WireProtocolIncompatible = z.infer<typeof wireProtocolIncompatibleSchema>;
export type WireHealth = z.infer<typeof wireHealthSchema>;
