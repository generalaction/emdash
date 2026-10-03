import type { Version3Client, Version3Models } from 'jira.js';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';

const jiraSiteUrlSchema = credentialString('Jira site URL is required.')
  .refine(isHttpUrl, 'Jira site URL must be a valid HTTP(S) URL.')
  .transform((value) => value.replace(/\/+$/, ''));

const basicJiraCredentialsSchema = z.object({
  authMethod: z.literal('basic'),
  siteUrl: jiraSiteUrlSchema,
  email: credentialString('Jira email is required.'),
  apiToken: credentialString('Jira API token is required.'),
});

const bearerJiraCredentialsSchema = z.object({
  authMethod: z.literal('bearer'),
  siteUrl: jiraSiteUrlSchema,
  accessToken: credentialString('Jira bearer token is required.'),
});

// Credentials stored before authMethod was introduced remain valid Basic Auth.
const legacyBasicJiraCredentialsSchema = z
  .object({
    siteUrl: jiraSiteUrlSchema,
    email: credentialString('Jira email is required.'),
    apiToken: credentialString('Jira API token is required.'),
  })
  .passthrough()
  .refine((value) => value.authMethod === undefined, {
    message: 'Jira authentication method is invalid.',
    path: ['authMethod'],
  })
  .transform(({ siteUrl, email, apiToken }) => ({ siteUrl, email, apiToken }));

export const jiraCredentialsSchema = z.union([
  basicJiraCredentialsSchema,
  bearerJiraCredentialsSchema,
  legacyBasicJiraCredentialsSchema,
]);

export type JiraCredentials = z.infer<typeof jiraCredentialsSchema>;

export type JiraClient = Version3Client;

export type JiraIssue = Version3Models.Issue;

export type JiraVerifiedConnection = {
  account?: VerifiedAccountIdentity;
  displayName?: string;
  displayDetail?: string;
  credentials: JiraCredentials;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
