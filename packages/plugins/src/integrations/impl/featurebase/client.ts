import { err, ok, type Result } from '@emdash/shared';
import Featurebase from 'featurebase-node';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import {
  type FeaturebaseClient,
  type FeaturebaseCredentials,
  featurebaseCredentialsSchema,
  type FeaturebaseVerifiedConnection,
} from './types';

export const FEATUREBASE_API_URL = 'https://do.featurebase.app';
export const FEATUREBASE_API_VERSION = '2026-01-01.nova';

export function readFeaturebaseCredentials(
  credentials: IntegrationCredentials
): Result<FeaturebaseCredentials, IntegrationError> {
  return parseCredentials(featurebaseCredentialsSchema, credentials);
}

export function createFeaturebaseClient(credentials: FeaturebaseCredentials): FeaturebaseClient {
  return new Featurebase({
    apiKey: credentials.apiKey,
    baseURL: FEATUREBASE_API_URL,
    defaultHeaders: {
      'Featurebase-Version': FEATUREBASE_API_VERSION,
    },
  });
}

export async function verifyFeaturebaseCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<FeaturebaseVerifiedConnection, IntegrationError>> {
  const credentials = readFeaturebaseCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createFeaturebaseClient(credentials.data);
  try {
    await client.feedback.posts.list({ limit: 1 });
    return ok({
      credentials: {
        apiKey: credentials.data.apiKey,
      },
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Featurebase'));
  }
}
