import { stat } from 'node:fs/promises';
import type { Scope } from '@emdash/shared/concurrency';
import { formatAbsolute, parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import { killSessionsUnderPath, type WorkspaceHostSessionClients } from './session-cleanup';

export interface WorkspaceHostSessionGcOptions {
  clients: WorkspaceHostSessionClients;
  intervalMs: number;
  scope?: Scope;
  onError?: (error: unknown) => void;
}

export class WorkspaceHostSessionGc {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly options: WorkspaceHostSessionGcOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.poke();
    }, this.options.intervalMs);
    this.timer.unref?.();
    this.options.scope?.add(() => this.dispose());
  }

  poke(): void {
    if (this.running) return;
    this.running = this.runOnce()
      .catch((error) => this.options.onError?.(error))
      .finally(() => {
        this.running = undefined;
      });
  }

  async runOnce(): Promise<void> {
    const paths = await this.missingSessionPaths();
    for (const path of paths) {
      const result = await killSessionsUnderPath(this.options.clients, path);
      if (!result.success) {
        this.options.onError?.(result.error);
      }
    }
  }

  dispose(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async missingSessionPaths(): Promise<HostAbsolutePath[]> {
    const candidates = await this.sessionPaths();
    const missing: HostAbsolutePath[] = [];
    for (const path of candidates) {
      if (await isDefinitivelyMissing(path)) {
        missing.push(path);
      }
    }
    return missing;
  }

  private async sessionPaths(): Promise<HostAbsolutePath[]> {
    const [terminalSnapshot, acpSnapshot, tuiSnapshot] = await Promise.all([
      this.options.clients.terminals.sessions.state(undefined, 'list').snapshot(),
      this.options.clients.acp.sessions.state(undefined, 'list').snapshot(),
      this.options.clients.tuiAgents.sessions.state(undefined, 'list').snapshot(),
    ]);

    const byPath = new Map<string, HostAbsolutePath>();
    const add = (path: HostAbsolutePath | null) => {
      if (!path) return;
      byPath.set(formatAbsolute(path), path);
    };

    for (const session of Object.values(terminalSnapshot.data)) {
      add(session.key.workspace.path);
    }
    for (const session of Object.values(acpSnapshot.data)) {
      add(session.cwd ? parsePath(session.cwd) : null);
    }
    for (const session of Object.values(tuiSnapshot.data)) {
      add(session.cwd ? parsePath(session.cwd) : null);
    }
    return [...byPath.values()];
  }
}

async function isDefinitivelyMissing(path: HostAbsolutePath): Promise<boolean> {
  try {
    await stat(formatAbsolute(path));
    return false;
  } catch (error) {
    return isMissingFsError(error);
  }
}

function isMissingFsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code?: unknown }).code) === 'ENOENT'
  );
}

function parsePath(path: string): HostAbsolutePath | null {
  const parsed = parseAbsolute(path);
  return parsed.success ? parsed.data : null;
}
