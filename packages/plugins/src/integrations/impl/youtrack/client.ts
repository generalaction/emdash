import { err, ok, type Result } from '@emdash/shared';
import axios from 'axios';
import { YouTrack as YouTrackSdkClient } from 'youtrack-client';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { toYouTrackIntegrationError } from './error';
import {
  type YouTrackClient,
  type YouTrackCredentials,
  youTrackCredentialsSchema,
  youTrackUserSchema,
  type YouTrackVerifiedConnection,
} from './types';

export const YOU_TRACK_REQUEST_TIMEOUT_MS = 15_000;

export function readYouTrackCredentials(
  credentials: IntegrationCredentials
): Result<YouTrackCredentials, IntegrationError> {
  return parseCredentials(youTrackCredentialsSchema, credentials);
}

export function createYouTrackClient(
  credentials: YouTrackCredentials,
  signal = AbortSignal.timeout(YOU_TRACK_REQUEST_TIMEOUT_MS)
): YouTrackClient {
  return YouTrackSdkClient.axiosClient(
    axios.create({ signal, maxRedirects: 0 }),
    credentials.instanceUrl,
    credentials.apiToken
  );
}

export async function verifyYouTrackCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<YouTrackVerifiedConnection, IntegrationError>> {
  const credentials = readYouTrackCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);
  try {
    const client = createYouTrackClient(credentials.data);
    const user = youTrackUserSchema.parse(
      await client.Users.getCurrentUserProfile({ fields: ['id', 'login', 'fullName'] })
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
    return err(toYouTrackIntegrationError(error));
  }
}
