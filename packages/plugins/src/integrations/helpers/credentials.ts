import type { IntegrationCredentials } from '../host';

export function readCredentialString(
  credentials: IntegrationCredentials,
  key: string
): string | null {
  const value = credentials[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readCredentialStringArray(
  credentials: IntegrationCredentials,
  key: string
): string[] {
  const value = credentials[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function requireCredentialString(
  credentials: IntegrationCredentials,
  key: string,
  message: string
): string {
  const value = readCredentialString(credentials, key);
  if (!value) throw new Error(message);
  return value;
}
