import { request } from 'node:https';
import type { URL } from 'node:url';

const REQUEST_TIMEOUT_MS = 30_000;

function encodeBasic(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
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
