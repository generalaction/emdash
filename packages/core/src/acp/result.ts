import z from "zod";

/**
 * Wraps a Result<T,E> on the wire as a discriminated union.
 * Domain outcomes use this helper; transport-level failures use oRPC .errors().
 */
export const result = <D extends z.ZodTypeAny, E extends z.ZodTypeAny>(data: D, error: E) =>
    z.discriminatedUnion('success', [
      z.object({ success: z.literal(true), data }),
      z.object({ success: z.literal(false), error }),
    ]);