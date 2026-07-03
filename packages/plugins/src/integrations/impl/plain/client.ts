import {
  AuthenticationError,
  ForbiddenError,
  PlainClient,
  PlainError,
  RateLimitError,
} from '@team-plain/graphql';
import { readCredentialString } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';

let client: PlainClient | null = null;
let clientToken: string | null = null;

export function toPlainErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthenticationError) {
    return error.message || 'Plain authentication failed. Check your API key.';
  }
  if (error instanceof ForbiddenError) {
    return error.message || 'Plain API key was accepted but is missing required permissions.';
  }
  if (error instanceof RateLimitError)
    return 'Plain API rate limit exceeded. Please try again shortly.';
  if (error instanceof PlainError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function plainApiKey(credentials: IntegrationCredentials): string {
  const apiKey = readCredentialString(credentials, 'apiKey');
  if (!apiKey) throw new Error('Plain API key cannot be empty.');
  return apiKey;
}

export function getPlainClient(credentials: IntegrationCredentials): PlainClient {
  const apiKey = plainApiKey(credentials);
  if (!client || clientToken !== apiKey) {
    client = new PlainClient({ apiKey });
    clientToken = apiKey;
  }
  return client;
}

export async function validatePlainCredentials(credentials: IntegrationCredentials): Promise<void> {
  const client = getPlainClient(credentials);
  try {
    await client.query.threads({ first: 1 });
  } catch (error) {
    if (
      error instanceof ForbiddenError ||
      error instanceof AuthenticationError ||
      error instanceof RateLimitError ||
      error instanceof PlainError
    ) {
      throw error;
    }
    if (error instanceof Error) throw new PlainError(error.message);
    throw new PlainError('Plain is not configured. Connect Plain in settings.');
  }
}
