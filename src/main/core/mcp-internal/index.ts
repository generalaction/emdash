import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { makeInstance, type McpInternalInstance } from './instance';

interface InternalHttpServer {
  start(): Promise<{ port: number }>;
  stop(): void;
  getPort(): number;
  getStatusUrl(): string;
}

class McpInternalService implements IInitializable, IDisposable {
  private instance: McpInternalInstance | null = null;
  private server: InternalHttpServer | null = null;

  async initialize(): Promise<void> {
    if (this.server) return;

    this.instance = makeInstance();
    const { McpInternalHttpServer } = await import('./http-server');
    this.server = new McpInternalHttpServer(this.instance);
    try {
      await this.server.start();
    } catch (error) {
      log.error('mcp-internal: failed to start', { error: String(error) });
      this.server = null;
      this.instance = null;
      return;
    }

    const { refreshEmdashCatalogEntry } = await import('./catalog-refresh');
    void refreshEmdashCatalogEntry(this.instance, this.server.getStatusUrl());
  }

  dispose(): void {
    this.server?.stop();
    this.server = null;
    this.instance = null;
  }

  getPtyEnv(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Record<string, string> | undefined {
    if (!this.instance || !this.server || this.server.getPort() === 0) return undefined;
    return {
      EMDASH_INSTANCE_ID: this.instance.instanceId,
      EMDASH_SESSION_ID: conversationId,
      EMDASH_TASK_ID: taskId,
      EMDASH_PROJECT_ID: projectId,
      EMDASH_STATUS_URL: this.server.getStatusUrl(),
      EMDASH_TOKEN: this.instance.token,
    };
  }
}

export const mcpInternalService = new McpInternalService();
