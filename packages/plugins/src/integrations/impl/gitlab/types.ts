import type { Gitlab, IssueSchemaWithBasicLabels } from '@gitbeaker/rest';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';
import { normalizeHostedInstanceUrl } from '../../helpers/hosted-instance';

const instanceUrlSchema = credentialString('A valid GitLab instance URL is required.')
  .transform((value) => normalizeHostedInstanceUrl(value))
  .pipe(z.string('A valid GitLab instance URL is required.'));

/** Personal, group, or project access token. */
export const gitLabTokenCredentialsSchema = z.object({
  instanceUrl: instanceUrlSchema,
  apiToken: credentialString('A GitLab API token is required.'),
});

/** OAuth token pair from device authorization; the refresh token rotates on use. */
export const gitLabOAuthCredentialsSchema = z.object({
  instanceUrl: instanceUrlSchema,
  accessToken: credentialString('A GitLab access token is required.'),
  refreshToken: credentialString('A GitLab refresh token is required.'),
  /** Epoch milliseconds. */
  expiresAt: z.number().int().positive(),
});

export const gitLabCredentialsSchema = z.union([
  gitLabTokenCredentialsSchema,
  gitLabOAuthCredentialsSchema,
]);

export type GitLabCredentials = z.infer<typeof gitLabCredentialsSchema>;
export type GitLabOAuthCredentials = z.infer<typeof gitLabOAuthCredentialsSchema>;

export type GitLabClient = Gitlab;

export type GitLabIssue = IssueSchemaWithBasicLabels;

export type GitLabVerifiedConnection = {
  account?: VerifiedAccountIdentity;
  displayName?: string;
  displayDetail?: string;
  credentials: GitLabCredentials;
};
