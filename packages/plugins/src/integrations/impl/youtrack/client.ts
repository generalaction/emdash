import { err, ok } from '@emdash/shared';
import z from 'zod';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { youTrackCredentialsSchema, youTrackUserSchema, type YouTrackCredentials } from './types';

export const YOU_TRACK_REQUEST_TIMEOUT_MS = 15_000;

export function readYouTrackCredentials(credentials: IntegrationCredentials) {
  return parseCredentials(youTrackCredentialsSchema, credentials);
}

export async function requestYouTrack<T>(
  credentials: YouTrackCredentials,
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  signal = AbortSignal.timeout(YOU_TRACK_REQUEST_TIMEOUT_MS)
): Promise<T> {
  const url = new URL(`${credentials.instanceUrl}/api/${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credentials.apiToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    // Never include the response body or request headers in an error: either can contain secrets.
    throw Object.assign(new Error(`YouTrack request failed (${response.status}).`), {
      status: response.status,
    });
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error('YouTrack returned an invalid API response.');
  return parsed.data;
}

export function toYouTrackError(error: unknown): IntegrationError {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError)
  ) {
    return {
      type: 'host_unreachable',
      message: 'Unable to reach YouTrack. Check your instance URL and network connection.',
    };
  }
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return { type: 'generic', message: 'YouTrack returned an invalid API response.' };
  }
  return toIntegrationError(error, 'YouTrack');
}

export async function verifyYouTrackCredentials(raw: IntegrationCredentials) {
  const credentials = readYouTrackCredentials(raw);
  if (!credentials.success) return err(credentials.error);
  try {
    const user = await requestYouTrack(
      credentials.data,
      'users/me',
      { fields: 'id,login,fullName' },
      youTrackUserSchema
    );
    return ok({
      credentials: credentials.data,
      account: {
        id: user.id,
        login: user.login,
        host: new URL(credentials.data.instanceUrl).host,
        scope: credentials.data.instanceUrl,
      },
      displayName: user.fullName || user.login,
      displayDetail: `${user.login} · ${credentials.data.instanceUrl}`,
    });
  } catch (error) {
    return err(toYouTrackError(error));
  }
}
