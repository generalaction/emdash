import type { Version2Client, Version2Models, Version3Client, Version3Models } from 'jira.js';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString, optionalCredentialString } from '../../helpers/credentials';

const jiraSiteUrlSchema = credentialString('Jira site URL is required.')
  .refine(isHttpUrl, 'Jira site URL must be a valid HTTP(S) URL.')
  .transform((value) => value.replace(/\/+$/, ''));

// The filter is ANDed with other clauses and Emdash appends its own sort.
const jiraJqlFilterSchema = optionalCredentialString()
  .refine(
    (value) => value === undefined || !jqlHasOrderBy(value),
    'Leave ORDER BY out of the Jira issue filter; issues are sorted by last update.'
  )
  .refine(
    (value) => value === undefined || jqlParenthesesBalanced(value),
    'Close every parenthesis in the Jira issue filter.'
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

/** Filters are ANDed with other clauses, so one carrying its own sort would break the query. */
export function jqlHasOrderBy(jql: string): boolean {
  return /\border\s+by\b/i.test(jql);
}

/** Each filter is wrapped in parentheses, so one that closes early would escape its own clause. */
export function jqlParenthesesBalanced(jql: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < jql.length; i++) {
    const char = jql[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth < 0) {
      return false;
    }
  }
  return depth === 0 && quote === undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
