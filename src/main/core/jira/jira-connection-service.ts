import { request } from 'node:https';
import { URL } from 'node:url';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { telemetryService } from '@main/lib/telemetry';

type JiraCreds = { siteUrl: string; email: string };

interface JiraKVSchema extends Record<string, unknown> {
  creds: JiraCreds;
}

interface JiraUser {
  accountId?: string;
  displayName?: string;
  name?: string;
  errorMessages?: string[];
}

const jiraKV = new KV<JiraKVSchema>('jira');

function encodeBasic(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
}

export class JiraConnectionService {
  private readonly JIRA_TOKEN_SECRET_KEY = 'emdash-jira-token';

  async saveCredentials(
    siteUrl: string,
    email: string,
    token: string
  ): Promise<{ success: boolean; displayName?: string; error?: string }> {
    try {
      const me = await this.getMyself(siteUrl, email, token);
      await encryptedAppSecretsStore.setSecret(this.JIRA_TOKEN_SECRET_KEY, token);
      await this.writeCreds({ siteUrl, email });
      telemetryService.capture('integration_connected', { provider: 'jira' });
      return { success: true, displayName: me?.displayName };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      try {
        await encryptedAppSecretsStore.deleteSecret(this.JIRA_TOKEN_SECRET_KEY);
      } catch {}
      try {
        await jiraKV.del('creds');
      } catch {}
      telemetryService.capture('integration_disconnected', { provider: 'jira' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const creds = await this.readCreds();
      if (!creds) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
        };
      }

      const token = await encryptedAppSecretsStore.getSecret(this.JIRA_TOKEN_SECRET_KEY);
      if (!token) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
        };
      }

      const me = await this.getMyself(creds.siteUrl, creds.email, token);
      return {
        connected: true,
        displayName: me?.displayName,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
      };
    }
  }

  async requireAuth(): Promise<{ siteUrl: string; email: string; token: string }> {
    const creds = await this.readCreds();
    if (!creds) throw new Error('Jira credentials not set.');

    const token = await encryptedAppSecretsStore.getSecret(this.JIRA_TOKEN_SECRET_KEY);
    if (!token) throw new Error('Jira token not found.');

    return { ...creds, token };
  }

  private async readCreds(): Promise<JiraCreds | null> {
    try {
      const obj = await jiraKV.get('creds');
      const siteUrl = String(obj?.siteUrl || '').trim();
      const email = String(obj?.email || '').trim();
      if (!siteUrl || !email) return null;
      return { siteUrl, email };
    } catch {
      return null;
    }
  }

  private async writeCreds(creds: JiraCreds): Promise<void> {
    await jiraKV.set('creds', { siteUrl: creds.siteUrl, email: creds.email });
  }

  private async getMyself(siteUrl: string, email: string, token: string): Promise<JiraUser> {
    const url = new URL('/rest/api/3/myself', siteUrl);
    const body = await this.doGet(url, email, token);
    const data = JSON.parse(body || '{}') as JiraUser;
    if (!data || data.errorMessages) {
      throw new Error('Failed to verify Jira token.');
    }
    return data;
  }

  private async doGet(url: URL, email: string, token: string): Promise<string> {
    return this.doRequest(url, email, token, 'GET');
  }

  private async doRequest(
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
}

export const jiraConnectionService = new JiraConnectionService();
