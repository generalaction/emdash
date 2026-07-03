import { readCredentialString } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';

export const FEATUREBASE_API_URL = 'https://do.featurebase.app';
export const FEATUREBASE_API_VERSION = '2026-01-01.nova';

type FeaturebaseErrorResponse = {
  error?: {
    message?: string;
    status?: number;
    type?: string;
  };
};

export class FeaturebaseHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'FeaturebaseHttpError';
  }
}

export class FeaturebaseClient {
  constructor(private readonly token: string) {}

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(path, FEATUREBASE_API_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (typeof value !== 'undefined') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Featurebase-Version': FEATUREBASE_API_VERSION,
      },
    });

    if (!response.ok) {
      let message = response.statusText || 'Featurebase request failed.';
      try {
        const body = (await response.json()) as FeaturebaseErrorResponse;
        message = body.error?.message || message;
      } catch {
        // Keep status text when the response body is not JSON.
      }
      throw new FeaturebaseHttpError(response.status, message);
    }

    return (await response.json()) as T;
  }
}

let client: FeaturebaseClient | null = null;
let clientToken: string | null = null;

export function toFeaturebaseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof FeaturebaseHttpError) {
    if (error.status === 401) return 'Featurebase authentication failed. Check your API key.';
    if (error.status === 403) {
      return 'Featurebase API key was accepted but is missing required permissions.';
    }
    if (error.status === 429) {
      return 'Featurebase API rate limit exceeded. Please try again shortly.';
    }
    if (error.status >= 500) return 'Featurebase API is temporarily unavailable. Please try again.';
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function featurebaseApiKey(credentials: IntegrationCredentials): string {
  const apiKey = readCredentialString(credentials, 'apiKey');
  if (!apiKey) throw new Error('Featurebase API key cannot be empty.');
  return apiKey;
}

export function getFeaturebaseClient(credentials: IntegrationCredentials): FeaturebaseClient {
  const apiKey = featurebaseApiKey(credentials);
  if (!client || clientToken !== apiKey) {
    client = new FeaturebaseClient(apiKey);
    clientToken = apiKey;
  }
  return client;
}

export async function verifyFeaturebaseCredentials(credentials: IntegrationCredentials) {
  const client = getFeaturebaseClient(credentials);
  await client.get('/v2/posts', { limit: 1 });
}
