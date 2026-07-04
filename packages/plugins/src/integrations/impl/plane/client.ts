import { err, ok, type Result } from '@emdash/shared';
import { PlaneClient as PlaneSdkClient } from '@makeplane/plane-node-sdk';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import {
  type PlaneClient,
  type PlaneCredentials,
  planeCredentialsSchema,
  type PlaneVerifiedConnection,
} from './types';

export function readPlaneCredentials(
  credentials: IntegrationCredentials
): Result<PlaneCredentials, IntegrationError> {
  return parseCredentials(planeCredentialsSchema, credentials);
}

export function createPlaneClient(credentials: PlaneCredentials): PlaneClient {
  return new PlaneSdkClient({
    baseUrl: credentials.apiBaseUrl,
    apiKey: credentials.apiKey,
  });
}

export async function verifyPlaneCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<PlaneVerifiedConnection, IntegrationError>> {
  const credentials = readPlaneCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createPlaneClient(credentials.data);
  const { workspaceSlug, apiBaseUrl } = credentials.data;
  try {
    const user = await client.users.me();
    await client.projects.list(workspaceSlug, { limit: 1 });

    const fullName = [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(' ');
    return ok({
      displayName: user.display_name?.trim() || fullName || user.email?.trim() || undefined,
      displayDetail: `${workspaceSlug} on ${new URL(apiBaseUrl).host}`,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Plane'));
  }
}
