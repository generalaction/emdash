import { request } from 'node:https';
import { URL } from 'node:url';
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

type JiraCreds = { siteUrl: string; email: string };

function encodeBasic(email: string, token: string) {
  const raw = `${email}:${token}`;
  return Buffer.from(raw).toString('base64');
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

  private readCreds(): JiraCreds | null {
    try {
      if (!existsSync(this.CONF_FILE)) return null;
      const raw = readFileSync(this.CONF_FILE, 'utf8');
      const obj = JSON.parse(raw);
      const siteUrl = String(obj?.siteUrl || '').trim();
      const email = String(obj?.email || '').trim();
      if (!siteUrl || !email) return null;
      return { siteUrl, email };
    } catch {
      return null;
    }
  }

  private writeCreds(creds: JiraCreds) {
    const { siteUrl, email } = creds;
    const obj: any = { siteUrl, email };
    writeFileSync(this.CONF_FILE, JSON.stringify(obj), 'utf8');
  }

  // Removed: project key storage — rely on exact key search instead

  async saveCredentials(
    siteUrl: string,
    email: string,
    token: string
  ): Promise<{
    success: boolean;
    displayName?: string;
    error?: string;
  }> {
    try {
      const me = await this.getMyself(siteUrl, email, token);
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE, this.ACCOUNT, token);
      this.writeCreds({ siteUrl, email });
      return { success: true, displayName: me?.displayName };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      const keytar = await import('keytar');
      try {
        await keytar.deletePassword(this.SERVICE, this.ACCOUNT);
      } catch {}
      try {
        if (existsSync(this.CONF_FILE)) unlinkSync(this.CONF_FILE);
      } catch {}
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
      const me = await this.getMyself(creds.siteUrl, creds.email, token);
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
    const { siteUrl, email, token } = await this.requireAuth();
    const jqlCandidates: string[] = [];
    // Pragmatic fallbacks that typically work with limited permissions
    jqlCandidates.push(
      'assignee = currentUser() ORDER BY updated DESC',
      'reporter = currentUser() ORDER BY updated DESC',
      'ORDER BY updated DESC'
    );

    for (const jql of jqlCandidates) {
      try {
        const issues = await this.searchRaw(siteUrl, email, token, jql, limit);
        if (issues.length > 0) return this.normalizeIssues(siteUrl, issues);
      } catch {
        // Try next candidate if this one is forbidden or failed
      }
    }
    // Final fallback: use issue picker to get recent/history issues, then hydrate via GET /issue/{key}
    try {
      const keys = await this.getRecentIssueKeys(siteUrl, email, token, limit);
      if (keys.length > 0) {
        const results: any[] = [];
        for (const key of keys.slice(0, limit)) {
          try {
            const issue = await this.getIssueByKey(siteUrl, email, token, key);
            if (issue) results.push(issue);
          } catch {
            // skip individual failures
          }
        }
        if (results.length > 0) return this.normalizeIssues(siteUrl, results);
      }
    } catch {
      // ignore
    }
    return [];
  }

  async searchIssues(searchTerm: string, limit = 20): Promise<any[]> {
    const term = (searchTerm || '').trim();
    if (!term) return [];
    const { siteUrl, email, token } = await this.requireAuth();
    const sanitized = term.replace(/\"/g, '\\\"');
    const inner = `text ~ \"${sanitized}\" OR key = ${term}`;
    const jql = inner;
    const data = await this.searchRaw(siteUrl, email, token, jql, limit);
    return this.normalizeIssues(siteUrl, data);
  }

  private async requireAuth(): Promise<{ siteUrl: string; email: string; token: string }> {
    const creds = this.readCreds();
    if (!creds) throw new Error('Jira credentials not set.');
    const keytar = await import('keytar');
    const token = await keytar.getPassword(this.SERVICE, this.ACCOUNT);
    if (!token) throw new Error('Jira token not found.');
    return { ...creds, token };
  }

  private async getMyself(siteUrl: string, email: string, token: string): Promise<any> {
    const url = new URL('/rest/api/3/myself', siteUrl);
    const body = await this.doGet(url, email, token);
    const data = JSON.parse(body || '{}');
    if (!data || data.errorMessages) {
      throw new Error('Failed to verify Jira token.');
    }
    return data;
  }

  private async searchRaw(
    siteUrl: string,
    email: string,
    token: string,
    jql: string,
    limit: number
  ) {
    const url = new URL('/rest/api/3/search', siteUrl);
    const payload = JSON.stringify({
      jql,
      maxResults: Math.min(Math.max(limit, 1), 100),
      fields: ['summary', 'updated', 'project', 'status', 'assignee'],
    });
    const body = await this.doRequest(url, email, token, 'POST', payload, {
      'Content-Type': 'application/json',
    });
    const data = JSON.parse(body || '{}');
    return Array.isArray(data?.issues) ? data.issues : [];
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
    return await new Promise<string>((resolve, reject) => {
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
        }
      );
      req.on('error', reject);
      if (payload && method === 'POST') {
        req.write(payload);
      }
      req.end();
    });
  }

  // Enhanced search that supports direct issue-key lookups and robust quoting
  async smartSearchIssues(searchTerm: string, limit = 20): Promise<any[]> {
    const term = (searchTerm || '').trim();
    if (!term) return [];
    const { siteUrl, email, token } = await this.requireAuth();

    const looksLikeKey = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term);
    if (looksLikeKey) {
      const keyUpper = term.toUpperCase();
      try {
        const issue = await this.getIssueByKey(siteUrl, email, token, keyUpper);
        if (issue) return this.normalizeIssues(siteUrl, [issue]);
      } catch {
        // If direct fetch fails (404/403/etc.), we fall back to JQL search below
      }
    }

    // Build JQL safely (escape quotes in term)
    const sanitized = term.replace(/"/g, '\\"');
    const extraKey = looksLikeKey ? ` OR issueKey = ${term.toUpperCase()}` : '';
    const inner = `text ~ \"${sanitized}\"${extraKey}`;
    const jql = inner;
    const data = await this.searchRaw(siteUrl, email, token, jql, limit);
    return this.normalizeIssues(siteUrl, data);
  }

  private async getIssueByKey(
    siteUrl: string,
    email: string,
    token: string,
    key: string
  ): Promise<any | null> {
    const url = new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, siteUrl);
    url.searchParams.set('fields', 'summary,updated,project,status,assignee');
    const body = await this.doGet(url, email, token);
    const data = JSON.parse(body || '{}');
    if (!data || data.errorMessages) return null;
    return data;
  }

  private async getRecentIssueKeys(
    siteUrl: string,
    email: string,
    token: string,
    limit: number
  ): Promise<string[]> {
    // Jira issue picker provides recent/history issue suggestions
    const url = new URL('/rest/api/3/issue/picker', siteUrl);
    url.searchParams.set('query', '');
    url.searchParams.set('currentJQL', '');
    const body = await this.doGet(url, email, token);
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

  private normalizeIssues(siteUrl: string, rawIssues: any[]): any[] {
    const base = siteUrl.replace(/\/$/, '');
    return (rawIssues || []).map((it) => {
      const fields = it?.fields || {};
      return {
        id: String(it?.id || it?.key || ''),
        key: String(it?.key || ''),
        summary: String(fields?.summary || ''),
        description: null,
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
