import type { Version3Client, Version3Models } from 'jira.js';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const jiraCredentialsSchema = z.object({
  siteUrl: credentialString('Jira site URL is required.')
    .refine(isHttpUrl, 'Jira site URL must be a valid HTTP(S) URL.')
    .transform((value) => value.replace(/\/+$/, '')),
  email: credentialString('Jira email is required.'),
  apiToken: credentialString('Jira API token is required.'),
});

export type JiraCredentials = z.infer<typeof jiraCredentialsSchema>;

export type JiraClient = Version3Client;

export type JiraIssue = Version3Models.Issue;

export type JiraVerifiedConnection = {
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
