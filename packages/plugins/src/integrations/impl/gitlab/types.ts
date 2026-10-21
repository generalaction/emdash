import type { Gitlab, IssueSchemaWithBasicLabels } from '@gitbeaker/rest';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';
import { normalizeHostedInstanceUrl } from '../../helpers/hosted-instance';

export const gitLabCredentialsSchema = z.object({
  instanceUrl: credentialString('A valid GitLab instance URL is required.')
    .transform((value) => normalizeHostedInstanceUrl(value))
    .pipe(z.string('A valid GitLab instance URL is required.')),
  apiToken: credentialString('A GitLab API token is required.'),
});

export type GitLabCredentials = z.infer<typeof gitLabCredentialsSchema>;

export type GitLabClient = Gitlab;

export type GitLabIssue = IssueSchemaWithBasicLabels;

export type GitLabVerifiedConnection = {
  account?: VerifiedAccountIdentity;
  displayName?: string;
  displayDetail?: string;
  credentials: GitLabCredentials;
};
