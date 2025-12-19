import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib/logger';
// TODO: Implement RunConfigGenerationService
// import { runConfigGenerationService } from './RunConfigGenerationService';
import { databaseService } from './DatabaseService';

// Temporary stub until RunConfigGenerationService is implemented
const runConfigGenerationService = {
  generateRunConfig: async (_projectPath: string, _preferredProvider?: string) => {
    return { config: null, provider: null };
  },
};

const PROJECT_CONFIG_PATH = '.emdash/config.json';

export type ProjectRunConfigStatus = 'idle' | 'generating' | 'ready' | 'failed';

export type ProjectRunConfigState = {
  projectId: string;
  status: ProjectRunConfigStatus;
  exists: boolean;
  provider?: string | null;
  error?: string | null;
  updatedAt?: string | null;
};

type ProjectRunConfigEvent = { type: 'config'; state: ProjectRunConfigState };

/**
 * Project-level run config generation and status tracking.
 * - Uses local CLI providers via RunConfigGenerationService.
 * - Writes `.emdash/config.json` at project root on success.
 * - Remembers `failed` in-memory until explicitly forced (DB persistence added later).
 */
class ProjectRunConfigService extends EventEmitter {
  private readonly states = new Map<string, ProjectRunConfigState>();

  private computeExists(projectPath: string): boolean {
    try {
      return fs.existsSync(path.join(projectPath, PROJECT_CONFIG_PATH));
    } catch {
      return false;
    }
  }

  getStatus(projectId: string, projectPath: string): ProjectRunConfigState {
    const exists = this.computeExists(projectPath);
    const current = this.states.get(projectId);
    if (exists) {
      const next: ProjectRunConfigState = {
        projectId,
        status: 'ready',
        exists: true,
        provider: current?.provider ?? null,
        error: null,
        updatedAt: current?.updatedAt ?? new Date().toISOString(),
      };
      this.states.set(projectId, next);
      return next;
    }
    return (
      current ?? {
        projectId,
        status: 'idle',
        exists: false,
        provider: null,
        error: null,
        updatedAt: null,
      }
    );
  }

  /**
   * Ensure `.emdash/config.json` exists for a project.
   * - If it exists, returns ready.
   * - If last attempt failed and `force !== true`, returns failed without retrying.
   */
  async ensureProjectConfig(args: {
    projectId: string;
    projectPath: string;
    preferredProvider?: string;
    force?: boolean;
  }): Promise<ProjectRunConfigState> {
    const { projectId, projectPath, preferredProvider, force } = args;
    const exists = this.computeExists(projectPath);
    if (exists) {
      const ready = this.getStatus(projectId, projectPath);
      try {
        // TODO: Add updateProjectRunConfigMeta to DatabaseService
        await (databaseService as any).updateProjectRunConfigMeta?.(projectId, {
          status: 'ready',
          error: null,
          provider: preferredProvider ?? ready.provider ?? null,
        });
      } catch {}
      this.emit('event', { type: 'config', state: ready } satisfies ProjectRunConfigEvent);
      return ready;
    }

    // Load persisted status to avoid auto-retrying after a failure.
    // TODO: Add getProjectRunConfigMeta to DatabaseService
    let persisted = null as any;
    try {
      persisted = await (databaseService as any).getProjectRunConfigMeta?.(projectId);
    } catch {}

    const current = this.states.get(projectId);
    if (current?.status === 'generating') {
      return current;
    }
    if (!force) {
      if (current?.status === 'failed') return current;
      if (persisted?.status === 'failed') {
        const failed: ProjectRunConfigState = {
          projectId,
          status: 'failed',
          exists: false,
          provider: persisted.provider ?? preferredProvider ?? null,
          error: persisted.error ?? 'Run config generation previously failed.',
          updatedAt: persisted.updatedAt ?? null,
        };
        this.states.set(projectId, failed);
        this.emit('event', { type: 'config', state: failed } satisfies ProjectRunConfigEvent);
        return failed;
      }
    }

    const generating: ProjectRunConfigState = {
      projectId,
      status: 'generating',
      exists: false,
      provider: preferredProvider ?? current?.provider ?? persisted?.provider ?? null,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    this.states.set(projectId, generating);
    try {
      await (databaseService as any).updateProjectRunConfigMeta?.(projectId, {
        status: 'generating',
        error: null,
        provider: generating.provider ?? null,
      });
    } catch {}
    this.emit('event', { type: 'config', state: generating } satisfies ProjectRunConfigEvent);

    try {
      const generated = await runConfigGenerationService.generateRunConfig(
        projectPath,
        preferredProvider
      );

      if (!generated?.config) {
        const failed: ProjectRunConfigState = {
          projectId,
          status: 'failed',
          exists: false,
          provider: preferredProvider ?? generating.provider ?? null,
          error:
            'AI generation failed. Please check that your CLI coding agent is available and configured.',
          updatedAt: new Date().toISOString(),
        };
        this.states.set(projectId, failed);
        try {
          await (databaseService as any).updateProjectRunConfigMeta?.(projectId, {
            status: 'failed',
            error: failed.error ?? null,
            provider: failed.provider ?? null,
          });
        } catch {}
        this.emit('event', { type: 'config', state: failed } satisfies ProjectRunConfigEvent);
        return failed;
      }

      const configPath = path.join(projectPath, PROJECT_CONFIG_PATH);
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(configPath, JSON.stringify(generated.config, null, 2), 'utf8');

      const ready: ProjectRunConfigState = {
        projectId,
        status: 'ready',
        exists: true,
        provider: preferredProvider ?? generating.provider ?? null,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      this.states.set(projectId, ready);
      try {
        await (databaseService as any).updateProjectRunConfigMeta?.(projectId, {
          status: 'ready',
          error: null,
          provider: ready.provider ?? null,
        });
      } catch {}
      this.emit('event', { type: 'config', state: ready } satisfies ProjectRunConfigEvent);
      return ready;
    } catch (error) {
      log.error('Failed to ensure project run config', { projectId, projectPath, error });
      const failed: ProjectRunConfigState = {
        projectId,
        status: 'failed',
        exists: false,
        provider: preferredProvider ?? generating.provider ?? null,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
      this.states.set(projectId, failed);
      try {
        await (databaseService as any).updateProjectRunConfigMeta?.(projectId, {
          status: 'failed',
          error: failed.error ?? null,
          provider: failed.provider ?? null,
        });
      } catch {}
      this.emit('event', { type: 'config', state: failed } satisfies ProjectRunConfigEvent);
      return failed;
    }
  }
}

export const projectRunConfigService = new ProjectRunConfigService();
