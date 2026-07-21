import os from 'node:os';
import type { CLIAgentPluginProvider, McpServerRegistration } from '@emdash/core/agents/plugins';
import type { McpLoadAllResponse, McpServer } from '@emdash/core/mcp';
import { pluginRegistry } from '@emdash/plugins/agents';
import { createPluginFs } from '@main/core/agents/plugin-fs';
import { log } from '@main/lib/logger';
import type { McpCatalogEntry } from '@shared/core/mcp/types';
import { loadCatalog } from '../utils/catalog';
import {
  mcpServerFieldCount,
  mcpServerToRegistration,
  registrationToMcpServer,
} from '../utils/registration';

function getMcpProviders() {
  return pluginRegistry
    .getAll()
    .filter(
      (p: CLIAgentPluginProvider) =>
        p.capabilities.mcp.kind === 'supported' && p.behavior.mcp != null
    );
}

export class McpService {
  private integrationsShDomainsCache:
    | { expiresAt: number; domains: IntegrationsShDomain[] }
    | undefined;
  private integrationsShDomainsRequest: Promise<IntegrationsShDomain[]> | undefined;
  private readonly integrationsShSearchCache = new Map<
    string,
    { expiresAt: number; entries: McpCatalogEntry[] }
  >();
  private _writeLock = Promise.resolve();

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this._writeLock;
    let resolve: () => void;
    this._writeLock = new Promise<void>((r) => {
      resolve = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  async loadAll(): Promise<McpLoadAllResponse> {
    return this.withWriteLock(async () => {
      const fs = createPluginFs(os.homedir());
      const providers = getMcpProviders();
      const serversByName = new Map<string, { server: McpServer; providers: Set<string> }>();

      for (const provider of providers) {
        const agentId = provider.metadata.id;
        let regs: McpServerRegistration[];
        try {
          regs = await provider.behavior.mcp!.readServers(fs);
        } catch (err) {
          log.warn(`Failed to read MCP config for ${agentId}:`, err);
          continue;
        }

        for (const reg of regs) {
          const server = registrationToMcpServer(reg, [agentId]);
          const existing = serversByName.get(reg.name);
          if (existing) {
            existing.providers.add(agentId);
            if (mcpServerFieldCount(server) > mcpServerFieldCount(existing.server)) {
              existing.server = server;
            }
          } else {
            serversByName.set(reg.name, { server, providers: new Set([agentId]) });
          }
        }
      }

      const installed: McpServer[] = [];
      for (const { server, providers } of serversByName.values()) {
        server.providers = Array.from(providers);
        installed.push(server);
      }

      return { installed, catalog: loadCatalog() };
    });
  }

  async searchIntegrationsSh(query: string): Promise<McpCatalogEntry[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length < 2) return [];

    const cached = this.integrationsShSearchCache.get(normalizedQuery);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;

    try {
      const domains = await this.getIntegrationsShDomains();
      const matches = domains
        .filter((entry) => entry.formats.mcp > 0)
        .filter(
          (entry) =>
            entry.domain.toLowerCase().includes(normalizedQuery) ||
            entry.description.toLowerCase().includes(normalizedQuery)
        )
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 12);

      let hasFailedDomain = false;
      const results = await Promise.all(
        matches.map(async (entry) => {
          try {
            return await this.loadIntegrationsShDomain(entry);
          } catch (error) {
            hasFailedDomain = true;
            log.warn(`integrations.sh domain fetch failed for "${entry.domain}"`, error);
            return [];
          }
        })
      );
      const entries = results.flat().slice(0, 24);
      if (hasFailedDomain) return cached?.entries ?? entries;

      this.integrationsShSearchCache.set(normalizedQuery, {
        expiresAt: Date.now() + INTEGRATIONS_SH_CACHE_TTL_MS,
        entries,
      });
      return entries;
    } catch (error) {
      if (cached) {
        log.warn(
          `integrations.sh search failed for "${normalizedQuery}", using stale cache`,
          error
        );
        return cached.entries;
      }
      log.warn(`integrations.sh search failed for "${normalizedQuery}"`, error);
      throw error;
    }
  }

  private async getIntegrationsShDomains(): Promise<IntegrationsShDomain[]> {
    const cached = this.integrationsShDomainsCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.domains;
    }
    if (this.integrationsShDomainsRequest) return this.integrationsShDomainsRequest;

    const request = this.fetchIntegrationsShDomains();
    this.integrationsShDomainsRequest = request;
    try {
      return await request;
    } finally {
      if (this.integrationsShDomainsRequest === request) {
        this.integrationsShDomainsRequest = undefined;
      }
    }
  }

  private async fetchIntegrationsShDomains(): Promise<IntegrationsShDomain[]> {
    const response = await fetch(INTEGRATIONS_SH_DOMAINS_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`integrations.sh returned HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) {
      throw new Error('integrations.sh returned an invalid domains document');
    }
    const domains = payload.data.filter(isIntegrationsShDomain);
    this.integrationsShDomainsCache = {
      expiresAt: Date.now() + INTEGRATIONS_SH_CACHE_TTL_MS,
      domains,
    };
    return domains;
  }

  private async loadIntegrationsShDomain(
    domainEntry: IntegrationsShDomain
  ): Promise<McpCatalogEntry[]> {
    const encodedDomain = encodeURIComponent(domainEntry.domain);
    const response = await fetch(`${INTEGRATIONS_SH_API_BASE_URL}/${encodedDomain}/surface`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`integrations.sh returned HTTP ${response.status}`);
    const payload = (await response.json()) as { description?: unknown; surfaces?: unknown };
    if (!Array.isArray(payload.surfaces)) {
      throw new Error('integrations.sh returned an invalid surface document');
    }

    const entries: McpCatalogEntry[] = [];
    for (const surface of payload.surfaces) {
      if (!isIntegrationsShMcpSurface(surface)) continue;
      const defaultConfig = toIntegrationsShDefaultConfig(surface);
      if (!defaultConfig) continue;
      entries.push({
        key: `integrations-sh-${domainEntry.domain}-${surface.slug}`,
        name: surface.name,
        description:
          typeof payload.description === 'string' ? payload.description : domainEntry.description,
        docsUrl:
          toSafeHttpUrl(surface.docs) ??
          `https://integrations.sh/${encodedDomain}/${surface.slug}/`,
        iconUrl: toSafeIntegrationsShIconUrl(domainEntry.icon),
        defaultConfig,
        credentialKeys: [],
      });
    }
    return entries;
  }

  async saveServer(server: McpServer): Promise<void> {
    if (!server.name || !/^[\w\-._]+$/.test(server.name)) {
      throw new Error(`Invalid server name: "${server.name}"`);
    }
    return this.withWriteLock(async () => {
      const fs = createPluginFs(os.homedir());
      const providers = getMcpProviders();
      const selectedProviders = new Set(server.providers);
      const failures: string[] = [];

      for (const provider of providers) {
        const agentId = provider.metadata.id;
        let regs: McpServerRegistration[];
        try {
          regs = await provider.behavior.mcp!.readServers(fs);
        } catch {
          regs = [];
        }

        const idx = regs.findIndex((r) => r.name === server.name);
        if (selectedProviders.has(agentId)) {
          const toWrite = mcpServerToRegistration(server);
          if (idx >= 0) {
            regs[idx] = toWrite;
          } else {
            regs.push(toWrite);
          }
        } else if (idx >= 0) {
          regs.splice(idx, 1);
        } else {
          continue;
        }

        try {
          await provider.behavior.mcp!.writeServers(fs, regs);
        } catch (err) {
          log.error(`Failed to write MCP config for ${agentId}:`, err);
          failures.push(agentId);
        }
      }

      if (failures.length) {
        throw new Error(`Failed to write config for: ${failures.join(', ')}`);
      }
    });
  }

  async removeServer(serverName: string): Promise<void> {
    return this.withWriteLock(async () => {
      const fs = createPluginFs(os.homedir());
      const providers = getMcpProviders();
      const failures: string[] = [];

      for (const provider of providers) {
        const agentId = provider.metadata.id;
        try {
          await provider.behavior.mcp!.removeServer(fs, serverName);
        } catch (err) {
          log.error(`Failed to remove MCP server from ${agentId}:`, err);
          failures.push(agentId);
        }
      }

      if (failures.length) {
        throw new Error(`Failed to remove config for: ${failures.join(', ')}`);
      }
    });
  }

  async listForAgent(agentId: string): Promise<McpServer[]> {
    const fs = createPluginFs(os.homedir());
    const provider = pluginRegistry.get(agentId);
    if (!provider || provider.capabilities.mcp.kind !== 'supported' || !provider.behavior.mcp) {
      return [];
    }
    try {
      const regs: McpServerRegistration[] = await provider.behavior.mcp.readServers(fs);
      return regs.map((r) => registrationToMcpServer(r, [agentId]));
    } catch (err) {
      log.warn(`Failed to read MCP config for ${agentId}:`, err);
      return [];
    }
  }
}

const INTEGRATIONS_SH_DOMAINS_URL = 'https://integrations.sh/api/domains.json';
const INTEGRATIONS_SH_API_BASE_URL = 'https://integrations.sh/api';
const INTEGRATIONS_SH_ORIGIN = 'https://integrations.sh';
const INTEGRATIONS_SH_CACHE_TTL_MS = 5 * 60_000;

interface IntegrationsShDomain {
  domain: string;
  icon: string;
  formats: { mcp: number };
  popularity: number;
  description: string;
}

interface IntegrationsShMcpSurface {
  type: 'mcp';
  slug: string;
  name: string;
  docs?: string;
  url?: string;
}

function isIntegrationsShDomain(value: unknown): value is IntegrationsShDomain {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<IntegrationsShDomain>;
  return (
    typeof entry.domain === 'string' &&
    /^[a-z0-9.-]+$/i.test(entry.domain) &&
    typeof entry.icon === 'string' &&
    typeof entry.formats?.mcp === 'number' &&
    typeof entry.popularity === 'number' &&
    typeof entry.description === 'string'
  );
}

function isIntegrationsShMcpSurface(value: unknown): value is IntegrationsShMcpSurface {
  if (!value || typeof value !== 'object') return false;
  const surface = value as Partial<IntegrationsShMcpSurface>;
  return (
    surface.type === 'mcp' &&
    typeof surface.slug === 'string' &&
    /^[a-z0-9-]+$/i.test(surface.slug) &&
    typeof surface.name === 'string' &&
    (surface.docs === undefined || typeof surface.docs === 'string') &&
    (surface.url === undefined || typeof surface.url === 'string')
  );
}

function toSafeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function toSafeIntegrationsShIconUrl(value: string): string | undefined {
  const url = toSafeHttpUrl(value);
  if (!url) return undefined;
  return new URL(url).origin === INTEGRATIONS_SH_ORIGIN ? url : undefined;
}

function toIntegrationsShDefaultConfig(
  surface: IntegrationsShMcpSurface
): Record<string, unknown> | null {
  if (surface.url) {
    const url = toSafeHttpUrl(surface.url);
    return url ? { type: 'http', url } : null;
  }
  return null;
}

export const mcpService = new McpService();
