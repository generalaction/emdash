import type { Issue, User } from '@llamaduck/forgejo-ts';
import type { Client } from '@llamaduck/forgejo-ts/client';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';
import { normalizeHostedInstanceUrl } from '../../helpers/hosted-instance';

export const forgejoCredentialsSchema = z.object({
  instanceUrl: credentialString('A valid Forgejo instance URL is required.')
    .transform((value) => normalizeHostedInstanceUrl(value))
    .pipe(z.string('A valid Forgejo instance URL is required.')),
  apiToken: credentialString('A Forgejo API token is required.'),
});

export type ForgejoCredentials = z.infer<typeof forgejoCredentialsSchema>;

export type ForgejoClient = Client;

export type ForgejoIssue = Issue;

export type ForgejoUser = User;

export type ForgejoVerifiedConnection = {
  displayName?: string;
  displayDetail?: string;
  credentials: ForgejoCredentials;
};
