import type { LinearClient as LinearSdkClient } from '@linear/sdk';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';

export const linearCredentialsSchema = z.object({
  apiKey: credentialString('Linear API key is required.'),
});

export type LinearCredentials = z.infer<typeof linearCredentialsSchema>;

export type LinearClient = LinearSdkClient;

export type LinearVerifiedConnection = {
  account?: VerifiedAccountIdentity;
  displayName?: string;
  displayDetail?: string;
  credentials: LinearCredentials;
};
