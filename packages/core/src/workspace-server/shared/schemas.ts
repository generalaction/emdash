import { resultSchema } from '@emdash/shared';
import { z } from 'zod';

/**
 * Wraps a Result<T,E> on the wire as a discriminated union.
 * Domain outcomes use this helper; transport-level failures use oRPC .errors().
 */
export const result = resultSchema;

/**
 * Wraps a LiveValue<T> (value + generation + sequence) for read-your-writes tracking.
 */
export const liveValue = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, generation: z.number().int(), sequence: z.number().int() });
