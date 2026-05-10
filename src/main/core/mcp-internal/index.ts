import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { buildEmdashServer, refreshEmdashCatalogEntry } from './catalog-refresh';
import { McpInternalHttpServer } from './http-server';
import { makeInstance, type McpInternalInstance } from './instance';

class McpInternalService implements IInitializable, IDisposable {
  private instance: McpInternalInstance | null = null;
  private server: McpInternalHttpServer | null = null;

  async initialize(): Promise<void> {
    if (this.server) return;
    this.instance = makeInstance();
    this.server = new McpInternalHttpServer(this.instance);
    try {
      await this.server.start();
    } catch (err) {
      log.error('mcp-internal: server failed to start', { error: String(err) });
      this.server = null;
      this.instance = null;
      return;
    }
    void refreshEmdashCatalogEntry(this.instance, this.server.getStatusUrl());
  }

  dispose(): void {
    this.server?.stop();
    this.server = null;
    this.instance = null;
  }

  /** Identity material for PTY env injection. Returns null if not running. */
  getPtyEnv(): {
    instanceId: string;
    token: string;
    statusUrl: string;
  } | null {
    if (!this.instance || !this.server || this.server.getPort() === 0) return null;
    return {
      instanceId: this.instance.instanceId,
      token: this.instance.token,
      statusUrl: this.server.getStatusUrl(),
    };
  }

  /**
   * Canonical raw config for the emdash MCP catalog entry under current
   * launch. Used by `loadCatalog()` to override the static placeholder so
   * fresh installs from the UI write the correct command/args/env.
   */
  getCanonicalRawConfig(): { command: string; args: string[]; env: Record<string, string> } | null {
    const env = this.getPtyEnv();
    if (!env) return null;
    const server = buildEmdashServer(
      { instanceId: env.instanceId, token: env.token },
      env.statusUrl,
      []
    );
    return {
      command: server.command ?? '',
      args: server.args ?? [],
      env: server.env ?? {},
    };
  }
}

export const mcpInternalService = new McpInternalService();
