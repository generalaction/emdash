import type { Version3Client, Version3Models } from 'jira.js';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';

const jiraSiteUrlSchema = credentialString('Jira site URL is required.')
  .refine(isHttpUrl, 'Jira site URL must be a valid HTTP(S) URL.')
  .transform((value) => value.replace(/\/+$/, ''));

const basicJiraCredentialsSchema = z.object({
  authMethod: z.string().trim().pipe(z.literal('basic')).default('basic'),
  siteUrl: jiraSiteUrlSchema,
  email: credentialString('Jira email is required.'),
  apiToken: credentialString('Jira API token is required.'),
});

const bearerJiraConnectionInputSchema = z.object({
  authMethod: z.string().trim().pipe(z.literal('bearer')),
  siteUrl: jiraSiteUrlSchema,
  accessToken: credentialString('Jira OAuth 2.0 access token is required.'),
});

export const jiraConnectionInputSchema = z.union([
  basicJiraCredentialsSchema,
  bearerJiraConnectionInputSchema,
]);

const bearerJiraCredentialsSchema = bearerJiraConnectionInputSchema.extend({
  cloudId: z.string().trim().min(1),
});

export const jiraCredentialsSchema = z.union([
  basicJiraCredentialsSchema,
  bearerJiraCredentialsSchema,
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
