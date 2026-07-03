import { LinearClient } from '@linear/sdk';
import { readCredentialString, requireCredentialString } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';

let client: LinearClient | null = null;
let clientToken: string | null = null;

export function linearApiKey(credentials: IntegrationCredentials): string {
  return requireCredentialString(credentials, 'apiKey', 'Linear API key is required.');
}

export function getLinearClientForToken(token: string): LinearClient {
  if (!client || clientToken !== token) {
    client = new LinearClient({ apiKey: token });
    clientToken = token;
  }
  return client;
}

export function getLinearClient(credentials: IntegrationCredentials): LinearClient {
  return getLinearClientForToken(linearApiKey(credentials));
}

export async function verifyLinearCredentials(credentials: IntegrationCredentials): Promise<{
  displayName?: string;
  displayDetail?: string;
}> {
  const apiKey = readCredentialString(credentials, 'apiKey');
  if (!apiKey) {
    throw new Error('Linear API key cannot be empty.');
  }

  const client = getLinearClientForToken(apiKey);
  const viewer = await client.viewer;
  const org = await viewer.organization;
  const displayName = viewer.displayName ?? org?.name ?? undefined;
  const displayDetail =
    org?.name && viewer.displayName && org.name !== viewer.displayName ? org.name : undefined;
  return { displayName, displayDetail };
}
