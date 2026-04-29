import z from 'zod';
import { err, ok, type Result } from '@shared/result';

const provisionOutputSchema = z.object({
  id: z.string(),
  host: z.string().min(1, 'Provisioner output must contain a non-empty "host" field').trim(),
  port: z.number().optional(),
  username: z.string().optional(),
  worktreePath: z.string().optional(),
  password: z.string().optional(),
});

export type ProvisionOutput = z.infer<typeof provisionOutputSchema>;

export type ParseError = { type: 'parse-error'; message: string };

export function parseProvisionOutput(stdout: string): Result<ProvisionOutput, ParseError> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return err({ type: 'parse-error', message: 'Provisioner returned empty output' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return err({
      type: 'parse-error',
      message: `Could not parse provisioner output as JSON: ${trimmed.slice(0, 200)}`,
    });
  }

  const result = provisionOutputSchema.safeParse(parsed);
  if (!result.success) {
    return err({
      type: 'parse-error',
      message: result.error.message,
    });
  }

  return ok(result.data);
}
