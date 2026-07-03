import { request } from 'node:https';
import { URL } from 'node:url';
import { readCredentialString, requireCredentialString } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';

const REQUEST_TIMEOUT_MS = 30_000;

type JiraUser = {
  accountId?: string;
  displayName?: string;
  name?: string;
  errorMessages?: string[];
};

export type JiraCredentials = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

function encodeBasic(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
}

export function readJiraCredentials(credentials: IntegrationCredentials): JiraCredentials {
  return {
    siteUrl: requireCredentialString(credentials, 'siteUrl', 'Jira site URL is required.'),
    email: requireCredentialString(credentials, 'email', 'Jira email is required.'),
    apiToken: requireCredentialString(credentials, 'apiToken', 'Jira API token is required.'),
  };
}

export function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl;
  }
}

export function formatJiraDisplayDetail(email: string, siteUrl: string): string {
  return `${email} · ${siteHost(siteUrl)}`;
}

export async function verifyJiraCredentials(credentials: IntegrationCredentials): Promise<{
  displayName?: string;
  displayDetail?: string;
}> {
  const { siteUrl, email, apiToken } = readJiraCredentials(credentials);
  const me = await getJiraMyself(siteUrl, email, apiToken);
  return {
    displayName: me?.displayName,
    displayDetail: formatJiraDisplayDetail(email, siteUrl),
  };
}

export async function getJiraMyself(
  siteUrl: string,
  email: string,
  token: string
): Promise<JiraUser> {
  if (!readCredentialString({ siteUrl }, 'siteUrl')) {
    throw new Error('Jira site URL is required.');
  }

  const url = new URL('/rest/api/3/myself', siteUrl);
  const body = await doJiraGet(url, email, token);
  const data = JSON.parse(body || '{}') as JiraUser;
  if (!data || data.errorMessages) {
    throw new Error('Failed to verify Jira token.');
  }
  return data;
}

export function doJiraGet(url: URL, email: string, token: string): Promise<string> {
  return doJiraRequest(url, email, token, 'GET');
}

export function doJiraPost(
  url: URL,
  email: string,
  token: string,
  payload: string
): Promise<string> {
  return doJiraRequest(url, email, token, 'POST', payload, {
    'Content-Type': 'application/json',
  });
}

function doJiraRequest(
  url: URL,
  email: string,
  token: string,
  method: 'GET' | 'POST',
  payload?: string,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const auth = encodeBasic(email, token);

  return new Promise<string>((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        ...(url.port ? { port: Number(url.port) } : {}),
        path: url.pathname + url.search,
        protocol: url.protocol,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(extraHeaders || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('error', reject);
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            const snippet = data?.slice(0, 200) || '';
            reject(new Error(`Jira API error ${res.statusCode}${snippet ? `: ${snippet}` : ''}`));
            return;
          }

          resolve(data);
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Jira request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    req.on('error', reject);
    if (payload && method === 'POST') {
      req.write(payload);
    }
    req.end();
  });
}
