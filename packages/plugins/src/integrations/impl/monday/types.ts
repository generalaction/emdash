import type { ApiClient as MondaySdkClient } from '@mondaydotcomorg/api';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';

export const mondayCredentialsSchema = z.object({
  apiToken: credentialString('Monday.com API token cannot be empty.'),
});

export type MondayCredentials = z.infer<typeof mondayCredentialsSchema>;

export type MondayClient = MondaySdkClient;

export type MondayViewerQuery = {
  me?: {
    id: string;
    name: string;
    account?: { id?: string | null; name: string } | null;
  } | null;
};

export const MONDAY_VIEWER_QUERY = 'query { me { id name account { id name } } }';

export type MondayVerifiedConnection = {
  account?: VerifiedAccountIdentity;
  displayName?: string;
  displayDetail?: string;
  credentials: MondayCredentials;
};
