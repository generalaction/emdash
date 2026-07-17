import type { MobileAccessError } from '@emdash/core/mobile-access';
import { err, type Result } from '@emdash/shared';

export function mobileError<T>(
  code: MobileAccessError['code'],
  message: string
): Result<T, MobileAccessError> {
  return err({ code, message });
}

export function toMobileError(error: unknown): MobileAccessError {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return { code: 'not_found', message };
  if (/not ready|workspace/i.test(message)) return { code: 'not_ready', message };
  if (/not available|unavailable/i.test(message)) return { code: 'not_available', message };
  if (/not supported|unsupported/i.test(message)) return { code: 'not_supported', message };
  if (/too large/i.test(message)) return { code: 'too_large', message };
  return { code: 'runtime_error', message };
}
