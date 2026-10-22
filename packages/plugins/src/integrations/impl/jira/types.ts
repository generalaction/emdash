import type { Version2Client, Version2Models, Version3Client, Version3Models } from 'jira.js';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString, optionalCredentialString } from '../../helpers/credentials';

const jiraSiteUrlSchema = credentialString('Jira site URL is required.')
  .refine(isHttpUrl, 'Jira site URL must be a valid HTTP(S) URL.')
  .transform((value) => value.replace(/\/+$/, ''));

// The filter is ANDed with other clauses and Emdash appends its own sort.
const jiraJqlFilterSchema = optionalCredentialString().refine(
  (value) => value === undefined || !/\border\s+by\b/i.test(value),
  'Leave ORDER BY out of the Jira issue filter; issues are sorted by last update.'
);

const basicJiraCredentialsSchema = z.object({
  authMethod: z.string().trim().pipe(z.literal('basic')).default('basic'),
  siteUrl: jiraSiteUrlSchema,
  email: credentialString('Jira email is required.'),
  apiToken: credentialString('Jira API token is required.'),
  jqlFilter: jiraJqlFilterSchema,
});

const bearerJiraConnectionInputSchema = z.object({
  authMethod: z.string().trim().pipe(z.literal('bearer')),
  siteUrl: jiraSiteUrlSchema,
  accessToken: credentialString('Jira OAuth 2.0 access token is required.'),
  jqlFilter: jiraJqlFilterSchema,
});

const patJiraCredentialsSchema = z.object({
  authMethod: z.string().trim().pipe(z.literal('pat')),
  siteUrl: jiraSiteUrlSchema,
  personalAccessToken: credentialString('Jira personal access token is required.'),
  jqlFilter: jiraJqlFilterSchema,
});

export const jiraConnectionInputSchema = z.union([
  basicJiraCredentialsSchema,
  bearerJiraConnectionInputSchema,
  patJiraCredentialsSchema,
]);

const bearerJiraCredentialsSchema = bearerJiraConnectionInputSchema.extend({
  cloudId: z.string().trim().min(1),
});

export const jiraCredentialsSchema = z.union([
  basicJiraCredentialsSchema,
  bearerJiraCredentialsSchema,
  patJiraCredentialsSchema,
]);

export type JiraCredentials = z.infer<typeof jiraCredentialsSchema>;

/** Cloud speaks REST v3; Data Center only serves v2, so personal access tokens get a v2 client. */
export type JiraClient = Version3Client | Version2Client;

export type JiraIssue = Version3Models.Issue | Version2Models.Issue;

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
