import type { LinearClient as LinearSdkClient } from '@linear/sdk';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const linearCredentialsSchema = z.object({
  apiKey: credentialString('Linear API key is required.'),
  // Workspace identity resolved during verification. Persisted so re-verify and
  // account display stay stable across token rotation. Optional: legacy
  // credentials predate these fields and are backfilled on next verify.
  organizationId: z.string().optional(),
  organizationUrlKey: z.string().optional(),
  organizationName: z.string().optional(),
});

export type LinearCredentials = z.infer<typeof linearCredentialsSchema>;

export type LinearClient = LinearSdkClient;

export type LinearVerifiedConnection = {
  /**
   * Stable per-workspace identity. `id` is the Linear organization id,
   * `login` its urlKey (workspace slug). Drives multi-account upsert/dedupe.
   */
  account: {
    id: string;
    login: string;
  };
  displayName?: string;
  displayDetail?: string;
  credentials: LinearCredentials;
};
