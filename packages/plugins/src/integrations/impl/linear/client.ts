import { err, ok, type Result } from '@emdash/shared';
import { LinearClient as LinearSdkClient } from '@linear/sdk';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { toLinearIntegrationError } from './error';
import {
  type LinearClient,
  type LinearCredentials,
  linearCredentialsSchema,
  type LinearVerifiedConnection,
} from './types';

export function readLinearCredentials(
  credentials: IntegrationCredentials
): Result<LinearCredentials, IntegrationError> {
  return parseCredentials(linearCredentialsSchema, credentials);
}

export function createLinearClient(credentials: LinearCredentials): LinearClient {
  return new LinearSdkClient({ apiKey: credentials.apiKey });
}

export async function verifyLinearCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<LinearVerifiedConnection, IntegrationError>> {
  const credentials = readLinearCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createLinearClient(credentials.data);
  try {
    const viewer = await client.viewer;
    const organization = await viewer.organization;
    const displayName = viewer.displayName || viewer.name || organization.name;
    return ok({
      displayName,
      displayDetail:
        organization.name && organization.name !== displayName ? organization.name : undefined,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toLinearIntegrationError(error, 'Failed to validate Linear token.'));
  }
}
