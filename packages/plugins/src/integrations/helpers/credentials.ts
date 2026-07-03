import { err, ok, type Result } from '@emdash/shared';
import z from 'zod';
import type { IntegrationCredentials } from '../host';
import type { IntegrationError } from '../types';

export function credentialString(message: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().min(1, message)
  );
}

export function optionalCredentialString() {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().optional());
}

export function parseCredentials<T>(
  schema: z.ZodType<T>,
  raw: IntegrationCredentials
): Result<T, IntegrationError> {
  const result = schema.safeParse(raw);
  if (result.success) return ok(result.data);

  return err({
    type: 'invalid_input',
    message: result.error.issues[0]?.message ?? 'Invalid credentials.',
  });
}
