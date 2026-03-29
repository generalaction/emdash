import { request } from 'node:https';
import { URL } from 'node:url';
import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import type { SentryIssue } from '../../shared/integrations/sentryTypes';

export type { SentryIssue };

const SENTRY_API_BASE = 'https://sentry.io/api/0';
const REQUEST_TIMEOUT_MS = 15_000;

export interface SentryOrganization {
  slug: string;
  name: string;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  organization: { slug: string };
}

export interface SentryConnectionStatus {
  connected: boolean;
  organizationName?: string;
  error?: string;
}

export class SentryService {
  private readonly SERVICE_NAME = 'emdash-sentry';
  private readonly ACCOUNT_NAME = 'auth-token';

  async saveToken(
    token: string,
    organizationSlug?: string
  ): Promise<{ success: boolean; organizationName?: string; error?: string }> {
    try {
      await this.storeToken(token);

      // Verify the token works by fetching organizations
      const orgs = await this.fetchOrganizations(token);
      if (orgs.length === 0) {
        throw new Error('No organizations found for this token.');
      }

      // Use provided org slug or default to first org
      const org = organizationSlug
        ? (orgs.find((o) => o.slug === organizationSlug) ?? orgs[0])
        : orgs[0];

      this.saveOrgSlug(org.slug);

      void import('../telemetry').then(({ capture }) => {
        void capture('sentry_connected');
      });

      return {
        success: true,
        organizationName: org.name,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Sentry token. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      this.clearOrgSlug();

      void import('../telemetry').then(({ capture }) => {
        void capture('sentry_disconnected');
      });

      return { success: true };
    } catch (error) {
      console.error('Failed to clear Sentry token:', error);
      return {
        success: false,
        error: 'Unable to remove Sentry token from keychain.',
      };
    }
  }

  async checkConnection(): Promise<SentryConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return { connected: false };
      }

      const orgs = await this.fetchOrganizations(token);
      const savedSlug = this.loadOrgSlug();
      const org = savedSlug ? (orgs.find((o) => o.slug === savedSlug) ?? orgs[0]) : orgs[0];

      if (!org) {
        return { connected: false, error: 'No organizations found.' };
      }

      return {
        connected: true,
        organizationName: org.name,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Sentry connection.';
      return { connected: false, error: message };
    }
  }

  async initialFetch(limit = 25): Promise<SentryIssue[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Sentry token not set. Connect Sentry in settings first.');
    }

    const orgSlug = this.loadOrgSlug();
    if (!orgSlug) {
      throw new Error('No Sentry organization configured.');
    }

    const sanitizedLimit = Math.min(Math.max(limit, 1), 100);
    const url = `${SENTRY_API_BASE}/organizations/${orgSlug}/issues/?query=is:unresolved&limit=${sanitizedLimit}&sort=date`;

    return this.apiGet<SentryIssue[]>(token, url);
  }

  async searchIssues(searchTerm: string, limit = 25): Promise<SentryIssue[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Sentry token not set. Connect Sentry in settings first.');
    }

    const orgSlug = this.loadOrgSlug();
    if (!orgSlug) {
      throw new Error('No Sentry organization configured.');
    }

    const trimmed = searchTerm.trim();
    if (!trimmed) return [];

    const sanitizedLimit = Math.min(Math.max(limit, 1), 100);
    const encodedQuery = encodeURIComponent(`is:unresolved ${trimmed}`);
    const url = `${SENTRY_API_BASE}/organizations/${orgSlug}/issues/?query=${encodedQuery}&limit=${sanitizedLimit}&sort=date`;

    return this.apiGet<SentryIssue[]>(token, url);
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private async fetchOrganizations(token: string): Promise<SentryOrganization[]> {
    return this.apiGet<SentryOrganization[]>(token, `${SENTRY_API_BASE}/organizations/`);
  }

  private async apiGet<T>(token: string, urlStr: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(urlStr);

      const req = request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error('Invalid or expired Sentry auth token. Please check your token.'));
              return;
            }

            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
              reject(
                new Error(`Sentry API error (${res.statusCode}): ${data || res.statusMessage}`)
              );
              return;
            }

            try {
              resolve(JSON.parse(data) as T);
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Sentry API request timed out.'));
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  private saveOrgSlug(orgSlug: string): void {
    try {
      const filePath = join(app.getPath('userData'), 'sentry.json');
      writeFileSync(filePath, JSON.stringify({ orgSlug }), 'utf-8');
    } catch (error) {
      console.error('Failed to save Sentry org slug:', error);
    }
  }

  private loadOrgSlug(): string | null {
    try {
      const filePath = join(app.getPath('userData'), 'sentry.json');
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      return data?.orgSlug ?? null;
    } catch {
      return null;
    }
  }

  private clearOrgSlug(): void {
    try {
      unlinkSync(join(app.getPath('userData'), 'sentry.json'));
    } catch {
      // file may not exist
    }
  }

  private async storeToken(token: string): Promise<void> {
    const clean = token.trim();
    if (!clean) {
      throw new Error('Sentry auth token cannot be empty.');
    }

    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, clean);
    } catch (error) {
      console.error('Failed to store Sentry token:', error);
      throw new Error('Unable to store Sentry token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to read Sentry token from keychain:', error);
      return null;
    }
  }
}

export const sentryService = new SentryService();

export default SentryService;
