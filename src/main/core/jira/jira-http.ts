import { request } from 'node:https';
import { URL } from 'node:url';

export function encodeBasic(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
}

export async function jiraRequest(
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

    req.on('error', reject);
    if (payload && method === 'POST') {
      req.write(payload);
    }
    req.end();
  });
}

export async function jiraGet(url: URL, email: string, token: string): Promise<string> {
  return jiraRequest(url, email, token, 'GET');
}

export async function jiraPostJson(
  siteUrl: string,
  email: string,
  token: string,
  path: string,
  payload: unknown
): Promise<unknown> {
  const url = new URL(path, siteUrl);
  const body = await jiraRequest(url, email, token, 'POST', JSON.stringify(payload), {
    'Content-Type': 'application/json',
  });
  return body ? JSON.parse(body) : null;
}

/**
 * Wrap a plain text string into Jira's Atlassian Document Format (ADF).
 * Required for the v3 issue / comment APIs.
 */
export function plainTextToAdf(text: string): unknown {
  const trimmed = text.trim();
  return {
    version: 1,
    type: 'doc',
    content: trimmed
      ? [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }]
      : [{ type: 'paragraph' }],
  };
}
