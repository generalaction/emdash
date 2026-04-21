import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { URL } from 'node:url';
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sortByUpdatedAtDesc } from '../utils/issueSorting';

type AuthType = 'basic' | 'bearer';
type JiraCreds = { siteUrl: string; email?: string; authType: AuthType };
type Auth =
  | { authType: 'basic'; email: string; token: string }
  | { authType: 'bearer'; token: string };

function encodeBasic(email: string, token: string) {
  const raw = `${email}:${token}`;
  return Buffer.from(raw).toString('base64');
}

function apiBase(authType: AuthType): string {
  return authType === 'bearer' ? '/rest/api/2' : '/rest/api/3';
}

function authHeader(auth: Auth): string {
  if (auth.authType === 'bearer') return `Bearer ${auth.token}`;
  return `Basic ${encodeBasic(auth.email, auth.token)}`;
}

export interface JiraConnectionStatus {
  connected: boolean;
  accountId?: string;
  displayName?: string;
  siteUrl?: string;
  error?: string;
}

export default class JiraService {
  private readonly SERVICE = 'emdash-jira';
  private readonly ACCOUNT = 'api-token';
  private readonly CONF_FILE = join(app.getPath('userData'), 'jira.json');
  private projectKeys: string[] = [];

  private readCreds(): JiraCreds | null {
    try {
      if (!existsSync(this.CONF_FILE)) return null;
      const raw = readFileSync(this.CONF_FILE, 'utf8');
      const obj = JSON.parse(raw);
      const siteUrl = String(obj?.siteUrl || '').trim();
      if (!siteUrl) return null;
      const authType: AuthType = obj?.authType === 'bearer' ? 'bearer' : 'basic';
      const email = String(obj?.email || '').trim();
      // Basic auth requires email; treat legacy/corrupt configs without email as invalid
      if (authType === 'basic' && !email) return null;
      return { siteUrl, email: email || undefined, authType };
    } catch {
      return null;
    }
  }

  private buildAuth(creds: JiraCreds, token: string): Auth {
    if (creds.authType === 'bearer') return { authType: 'bearer', token };
    if (!creds.email) {
      throw new Error('Jira email missing for Basic auth. Please reconnect Jira.');
    }
    return { authType: 'basic', email: creds.email, token };
  }

  private buildUrl(siteUrl: string, path: string): URL {
    // Preserve any context path (e.g. https://jira.example.com/jira) — new URL(path, base)
    // would discard it because absolute paths reset. Concatenate instead.
    const base = siteUrl.replace(/\/+$/, '');
    return new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  }

  private writeCreds(creds: JiraCreds) {
    const obj: Record<string, string> = { siteUrl: creds.siteUrl, authType: creds.authType };
    if (creds.authType === 'basic' && creds.email) obj.email = creds.email;
    writeFileSync(this.CONF_FILE, JSON.stringify(obj), 'utf8');
  }

  async saveCredentials(
    siteUrl: string,
    token: string,
    authType: AuthType,
    email?: string
  ): Promise<{
    success: boolean;
    displayName?: string;
    error?: string;
  }> {
    try {
      if (authType === 'basic' && !email) {
        return { success: false, error: 'Email is required for Basic auth.' };
      }
      const auth: Auth =
        authType === 'bearer'
          ? { authType: 'bearer', token }
          : { authType: 'basic', email: email as string, token };
      const me = await this.getMyself(siteUrl, auth);
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE, this.ACCOUNT, token);
      this.writeCreds({ siteUrl, email: email || undefined, authType });
      void import('../telemetry').then(({ capture }) => {
        void capture('jira_connected');
      });
      return { success: true, displayName: me?.displayName };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      const keytar = await import('keytar');
      this.projectKeys = [];
      try {
        await keytar.deletePassword(this.SERVICE, this.ACCOUNT);
      } catch {}
      try {
        if (existsSync(this.CONF_FILE)) unlinkSync(this.CONF_FILE);
      } catch {}
      void import('../telemetry').then(({ capture }) => {
        void capture('jira_disconnected');
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  async checkConnection(): Promise<JiraConnectionStatus> {
    try {
      const creds = this.readCreds();
      if (!creds) return { connected: false };
      const keytar = await import('keytar');
      const token = await keytar.getPassword(this.SERVICE, this.ACCOUNT);
      if (!token) return { connected: false };
      const auth = this.buildAuth(creds, token);
      const me = await this.getMyself(creds.siteUrl, auth);
      this.fetchProjectKeys(creds.siteUrl, auth)
        .then((keys) => {
          this.projectKeys = keys;
        })
        .catch(() => {});
      return {
        connected: true,
        accountId: me?.accountId,
        displayName: me?.displayName,
        siteUrl: creds.siteUrl,
      };
    } catch (e: any) {
      return { connected: false, error: e?.message || String(e) };
    }
  }

  async initialFetch(limit = 50): Promise<any[]> {
    const { siteUrl, auth } = await this.requireAuth();
    const jqlCandidates: string[] = [];
    jqlCandidates.push(
      'assignee = currentUser() ORDER BY updated DESC',
      'reporter = currentUser() ORDER BY updated DESC',
      'ORDER BY updated DESC'
    );

    for (const jql of jqlCandidates) {
      try {
        const issues = await this.searchRaw(siteUrl, auth, jql, limit);
        if (issues.length > 0) return sortByUpdatedAtDesc(this.normalizeIssues(siteUrl, issues));
      } catch {
        // Try next candidate if this one is forbidden or failed
      }
    }
    try {
      const keys = await this.getRecentIssueKeys(siteUrl, auth, limit);
      if (keys.length > 0) {
        const results: any[] = [];
        for (const key of keys.slice(0, limit)) {
          try {
            const issue = await this.getIssueByKey(siteUrl, auth, key);
            if (issue) results.push(issue);
          } catch {
            // skip individual failures
          }
        }
        if (results.length > 0) return sortByUpdatedAtDesc(this.normalizeIssues(siteUrl, results));
      }
    } catch {
      // ignore
    }
    return [];
  }

  async searchIssues(searchTerm: string, limit = 20): Promise<any[]> {
    const term = (searchTerm || '').trim();
    if (!term) return [];
    const { siteUrl, auth } = await this.requireAuth();
    const sanitized = term.replace(/\"/g, '\\\"');
    const jql = `text ~ \"${sanitized}\" OR key = ${term}`;
    const data = await this.searchRaw(siteUrl, auth, jql, limit);
    return sortByUpdatedAtDesc(this.normalizeIssues(siteUrl, data));
  }

  private async requireAuth(): Promise<{ siteUrl: string; auth: Auth }> {
    const creds = this.readCreds();
    if (!creds) throw new Error('Jira credentials not set.');
    const keytar = await import('keytar');
    const token = await keytar.getPassword(this.SERVICE, this.ACCOUNT);
    if (!token) throw new Error('Jira token not found.');
    const auth = this.buildAuth(creds, token);
    return { siteUrl: creds.siteUrl, auth };
  }

  private async getMyself(siteUrl: string, auth: Auth): Promise<any> {
    const url = this.buildUrl(siteUrl, `${apiBase(auth.authType)}/myself`);
    const body = await this.doGet(url, auth);
    const data = JSON.parse(body || '{}');
    if (!data || data.errorMessages) {
      throw new Error('Failed to verify Jira token.');
    }
    return data;
  }

  private async searchRaw(siteUrl: string, auth: Auth, jql: string, limit: number) {
    const url = this.buildUrl(siteUrl, `${apiBase(auth.authType)}/search`);
    const payload = JSON.stringify({
      jql,
      maxResults: Math.min(Math.max(limit, 1), 100),
      fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
    });
    const body = await this.doRequest(url, auth, 'POST', payload, {
      'Content-Type': 'application/json',
    });
    const data = JSON.parse(body || '{}');
    return Array.isArray(data?.issues) ? data.issues : [];
  }

  private async doGet(url: URL, auth: Auth): Promise<string> {
    return this.doRequest(url, auth, 'GET');
  }

  private async doRequest(
    url: URL,
    auth: Auth,
    method: 'GET' | 'POST',
    payload?: string,
    extraHeaders?: Record<string, string>
  ): Promise<string> {
    const transport = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const options: RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      method,
      headers: {
        Authorization: authHeader(auth),
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(extraHeaders || {}),
      },
    };
    if (url.port) options.port = Number(url.port);
    return await new Promise<string>((resolve, reject) => {
      const req = transport(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            const snippet = data?.slice(0, 200) || '';
            return reject(
              new Error(`Jira API error ${res.statusCode}${snippet ? `: ${snippet}` : ''}`)
            );
          }
          resolve(data);
        });
      });
      req.on('error', reject);
      if (payload && method === 'POST') {
        req.write(payload);
      }
      req.end();
    });
  }

  async smartSearchIssues(searchTerm: string, limit = 20): Promise<any[]> {
    const term = (searchTerm || '').trim();
    if (!term) return [];
    const { siteUrl, auth } = await this.requireAuth();

    const looksLikeKey = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term);
    if (looksLikeKey) {
      const keyUpper = term.toUpperCase();
      try {
        const issue = await this.getIssueByKey(siteUrl, auth, keyUpper);
        if (issue) return sortByUpdatedAtDesc(this.normalizeIssues(siteUrl, [issue]));
      } catch {
        // If direct fetch fails (404/403/etc.), falling back to JQL search below
      }
    }

    const sanitized = term.replace(/"/g, '\\"');
    const extraKey = looksLikeKey ? ` OR issueKey = ${term.toUpperCase()}` : '';
    const isNumeric = /^\d+$/.test(term);
    const keyClause =
      isNumeric && this.projectKeys.length
        ? ` OR key IN (${this.projectKeys.map((p) => `"${p}-${term}"`).join(',')})`
        : '';
    const jql = `text ~ "${sanitized}"${extraKey}${keyClause}`;
    const data = await this.searchRaw(siteUrl, auth, jql, limit);
    return sortByUpdatedAtDesc(this.normalizeIssues(siteUrl, data));
  }

  private async fetchProjectKeys(siteUrl: string, auth: Auth): Promise<string[]> {
    try {
      const url = this.buildUrl(siteUrl, `${apiBase(auth.authType)}/project`);
      const body = await this.doGet(url, auth);
      const data = JSON.parse(body || '[]');
      if (!Array.isArray(data)) return [];
      return data.map((p: any) => String(p?.key || '')).filter(Boolean);
    } catch {
      return [];
    }
  }

  private async getIssueByKey(siteUrl: string, auth: Auth, key: string): Promise<any | null> {
    const url = this.buildUrl(
      siteUrl,
      `${apiBase(auth.authType)}/issue/${encodeURIComponent(key)}`
    );
    url.searchParams.set('fields', 'summary,description,updated,project,status,assignee');
    const body = await this.doGet(url, auth);
    const data = JSON.parse(body || '{}');
    if (!data || data.errorMessages) return null;
    return data;
  }

  private async getRecentIssueKeys(siteUrl: string, auth: Auth, limit: number): Promise<string[]> {
    const url = this.buildUrl(siteUrl, `${apiBase(auth.authType)}/issue/picker`);
    url.searchParams.set('query', '');
    url.searchParams.set('currentJQL', '');
    const body = await this.doGet(url, auth);
    const data = JSON.parse(body || '{}');
    const keys: string[] = [];
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    for (const sec of sections) {
      const issues = Array.isArray(sec?.issues) ? sec.issues : [];
      for (const it of issues) {
        const k = String(it?.key || '').trim();
        if (k && !keys.includes(k)) keys.push(k);
        if (keys.length >= limit) break;
      }
      if (keys.length >= limit) break;
    }
    return keys;
  }

  private static flattenAdf(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    if (Array.isArray(node.content)) {
      const parts = node.content.map((c: any) => JiraService.flattenAdf(c));
      if (['doc', 'bulletList', 'orderedList'].includes(node.type)) {
        return parts.join('\n');
      }
      if (['paragraph', 'heading', 'listItem'].includes(node.type)) {
        return parts.join('');
      }
      return parts.join('');
    }
    return '';
  }

  private normalizeIssues(siteUrl: string, rawIssues: any[]): any[] {
    const base = siteUrl.replace(/\/$/, '');
    return (rawIssues || []).map((it) => {
      const fields = it?.fields || {};
      return {
        id: String(it?.id || it?.key || ''),
        key: String(it?.key || ''),
        summary: String(fields?.summary || ''),
        description: fields?.description ? JiraService.flattenAdf(fields.description) : null,
        url: `${base}/browse/${it?.key}`,
        status: fields?.status ? { name: fields.status.name } : null,
        project: fields?.project ? { key: fields.project.key, name: fields.project.name } : null,
        assignee: fields?.assignee
          ? { displayName: fields.assignee.displayName, name: fields.assignee.name }
          : null,
        updatedAt: fields?.updated || null,
      };
    });
  }
}
