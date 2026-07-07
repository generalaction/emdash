import type { Client as NotionSdkClient } from '@notionhq/client';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const notionCredentialsSchema = z.object({
  apiToken: credentialString('Notion integration token is required.'),
});

export type NotionCredentials = z.infer<typeof notionCredentialsSchema>;

export type NotionClient = NotionSdkClient;

export type NotionVerifiedConnection = {
  displayName?: string;
  displayDetail?: string;
  credentials: NotionCredentials;
};
