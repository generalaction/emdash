import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib/logger';
import { hostPreviewService, type HostPreviewEvent } from './HostPreviewService';
import { runConfigGenerationService } from './RunConfigGenerationService';
import type { ResolvedRunConfig } from '../../shared/worktreeRun/config';
import { resolveRunConfig } from '../../shared/worktreeRun/config';

const PROJECT_CONFIG_PATH = '.emdash/config.json';
const WORKTREE_CONFIG_PATH = '.emdash/config.worktree.json';

export type WorktreeRunStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface WorktreeRunState {
  workspaceId: string;
  status: WorktreeRunStatus;
  config: ResolvedRunConfig | null;
  previewUrl: string | null;
  error: string | null;
}

export type WorktreeRunEvent =
  | { type: 'status'; workspaceId: string; status: WorktreeRunStatus }
  | { type: 'url'; workspaceId: string; url: string }
  | { type: 'log'; workspaceId: string; line: string }
  | { type: 'error'; workspaceId: string; error: string };

/**
 * Orchestrates worktree run execution
 * - Loads config (with inheritance: worktree overrides project)
 * - Delegates to HostPreviewService for execution
 * - Tracks running state per worktree
 */
class WorktreeRunService extends EventEmitter {
  private states = new Map<string, WorktreeRunState>();

  constructor() {
    super();

    // Forward HostPreviewService events
    hostPreviewService.on('event', (event: HostPreviewEvent) => {
      const { workspaceId, type, url, line, status: setupStatus } = event;

      if (type === 'url' && url) {
        // Update state with preview URL
        const state = this.states.get(workspaceId);
        if (state) {
          this.states.set(workspaceId, { ...state, previewUrl: url });
        }
        this.emit('event', { type: 'url', workspaceId, url } as WorktreeRunEvent);
      } else if (type === 'setup' && line) {
        // Forward setup logs
        this.emit('event', { type: 'log', workspaceId, line } as WorktreeRunEvent);
      } else if (type === 'exit') {
        // Handle exit
        const state = this.states.get(workspaceId);
        if (state) {
          this.updateState(workspaceId, { status: 'stopped', previewUrl: null });
        }
      }
    });
  }

  /**
   * Start a worktree with its run config
   */
  async start(
    workspaceId: string,
    worktreePath: string,
    projectPath: string,
    options?: { scriptName?: string; preferredProvider?: string }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      // Load config (worktree overrides project)
      const config = await this.loadConfig(worktreePath, projectPath, options?.preferredProvider);
      if (!config) {
        return { ok: false, error: 'No run configuration found or generated' };
      }

      // Update state
      this.updateState(workspaceId, {
        status: 'starting',
        config,
        previewUrl: null,
        error: null,
      });

      // Find script to run
      const scriptName = options?.scriptName || config.scripts.find((s) => s.preview)?.name;
      const script = scriptName
        ? config.scripts.find((s) => s.name === scriptName)
        : config.scripts[0];

      if (!script) {
        const error = 'No script found to run';
        this.updateState(workspaceId, { status: 'error', error });
        return { ok: false, error };
      }

      // Build script command (handle package manager + custom command)
      const scriptCommand = script.command;

      // Start via HostPreviewService
      const result = await hostPreviewService.start(workspaceId, worktreePath, {
        script: scriptCommand,
        parentProjectPath: projectPath,
      });

      if (result.ok) {
        this.updateState(workspaceId, { status: 'running' });
      } else {
        this.updateState(workspaceId, {
          status: 'error',
          error: result.error || 'Failed to start',
        });
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Failed to start worktree run', { workspaceId, error });
      this.updateState(workspaceId, { status: 'error', error: errorMsg });
      return { ok: false, error: errorMsg };
    }
  }

  /**
   * Stop a running worktree
   */
  stop(workspaceId: string): { ok: boolean } {
    const result = hostPreviewService.stop(workspaceId);
    if (result.ok) {
      this.updateState(workspaceId, { status: 'stopped', previewUrl: null });
    }
    return result;
  }

  /**
   * Get current state for a worktree
   */
  getState(workspaceId: string): WorktreeRunState | null {
    return this.states.get(workspaceId) || null;
  }

  /**
   * Load config with inheritance (worktree overrides project)
   * Generates config via AI if missing
   */
  private async loadConfig(
    worktreePath: string,
    projectPath: string,
    preferredProvider?: string
  ): Promise<ResolvedRunConfig | null> {
    // Try worktree-specific config first
    const worktreeConfigPath = path.join(worktreePath, WORKTREE_CONFIG_PATH);
    if (fs.existsSync(worktreeConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(worktreeConfigPath, 'utf8'));
        const resolved = resolveRunConfig(raw, {});
        log.info('Loaded worktree-specific config', { worktreePath });
        return resolved;
      } catch (err) {
        log.warn('Failed to parse worktree config, falling back to project config', {
          err,
          worktreeConfigPath,
        });
      }
    }

    // Try project-level config
    const projectConfigPath = path.join(projectPath, PROJECT_CONFIG_PATH);
    if (fs.existsSync(projectConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        const resolved = resolveRunConfig(raw, {});
        log.info('Loaded project config', { projectPath });
        return resolved;
      } catch (err) {
        log.warn('Failed to parse project config, generating new config', {
          err,
          projectConfigPath,
        });
      }
    }

    // No config exists - generate via AI
    log.info('No config found, generating via AI', { projectPath });
    const generated = await runConfigGenerationService.generateRunConfig(
      projectPath,
      preferredProvider
    );

    if (generated) {
      // Save generated config to project
      try {
        const configDir = path.dirname(projectConfigPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(projectConfigPath, JSON.stringify(generated.config, null, 2), 'utf8');
        log.info('Saved generated config to project', { projectConfigPath });

        return resolveRunConfig(generated.config, {});
      } catch (err) {
        log.error('Failed to save generated config', { err, projectConfigPath });
      }
    }

    // Fallback: Generate heuristic config
    log.warn('AI generation failed, using heuristic config', { projectPath });
    const heuristic = await runConfigGenerationService.generateHeuristicConfig(projectPath);

    // Try to save heuristic config
    try {
      const configDir = path.dirname(projectConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const configFile: any = {
        version: 1,
        packageManager: heuristic.packageManager,
        install: heuristic.install,
        scripts: heuristic.scripts,
      };
      fs.writeFileSync(projectConfigPath, JSON.stringify(configFile, null, 2), 'utf8');
      log.info('Saved heuristic config to project', { projectConfigPath });
    } catch (err) {
      log.warn('Failed to save heuristic config', { err });
    }

    return heuristic;
  }

  /**
   * Update state and emit event
   */
  private updateState(workspaceId: string, updates: Partial<WorktreeRunState>): void {
    const current = this.states.get(workspaceId) || {
      workspaceId,
      status: 'idle' as const,
      config: null,
      previewUrl: null,
      error: null,
    };

    const newState = { ...current, ...updates };
    this.states.set(workspaceId, newState);

    // Emit status event
    if (updates.status) {
      this.emit('event', {
        type: 'status',
        workspaceId,
        status: updates.status,
      } as WorktreeRunEvent);
    }

    // Emit error event
    if (updates.error) {
      this.emit('event', {
        type: 'error',
        workspaceId,
        error: updates.error,
      } as WorktreeRunEvent);
    }
  }

  /**
   * Subscribe to run events
   */
  onEvent(listener: (event: WorktreeRunEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const worktreeRunService = new WorktreeRunService();
