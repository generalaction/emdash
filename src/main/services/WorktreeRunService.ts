import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib/logger';
import { hostPreviewService, type HostPreviewEvent } from './hostPreviewService';
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

    // Forward HostPreviewService events with script prefixing
    hostPreviewService.on('event', (event: HostPreviewEvent) => {
      const { workspaceId: scriptWorkspaceId, type, url, line, status: setupStatus } = event;

      // Parse scriptWorkspaceId format: "workspaceId::scriptName"
      const parts = scriptWorkspaceId.split('::');
      const workspaceId = parts[0];
      const scriptName = parts[1] || 'default';

      if (type === 'url' && url) {
        // Update state with preview URL (only from the first script with preview=true)
        const state = this.states.get(workspaceId);
        if (state && state.config) {
          const script = state.config.scripts.find((s) => s.name === scriptName);
          if (script?.preview) {
            this.states.set(workspaceId, { ...state, previewUrl: url });
            this.emit('event', { type: 'url', workspaceId, url } as WorktreeRunEvent);
          }
        }
      } else if (type === 'setup' && line) {
        // Forward logs with script name prefix
        const prefixedLine = `[${scriptName}] ${line}`;
        this.emit('event', { type: 'log', workspaceId, line: prefixedLine } as WorktreeRunEvent);
      } else if (type === 'exit') {
        // Handle exit - check if all scripts have exited
        const state = this.states.get(workspaceId);
        if (state && state.config) {
          // Check if all script workspaces have exited
          const allScripts = state.config.scripts;
          const stillRunning = allScripts.some((script) => {
            const sid = `${workspaceId}::${script.name}`;
            return sid !== scriptWorkspaceId && hostPreviewService.isRunning(sid);
          });

          if (!stillRunning) {
            this.updateState(workspaceId, { status: 'stopped', previewUrl: null });
          }
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
        return { 
          ok: false, 
          error: 'Failed to generate run configuration. Please create .emdash/config.json manually using the config editor.' 
        };
      }

      // Update state
      this.updateState(workspaceId, {
        status: 'starting',
        config,
        previewUrl: null,
        error: null,
      });

      // Run ALL scripts (not just one)
      if (config.scripts.length === 0) {
        const error = 'No scripts found in config';
        this.updateState(workspaceId, { status: 'error', error });
        return { ok: false, error };
      }

      // Start all scripts with prefixed logs
      const scriptPromises = config.scripts.map(async (script) => {
        const scriptCommand = script.command;
        const scriptCwd = script.cwd && script.cwd !== '.' 
          ? path.join(worktreePath, script.cwd)
          : worktreePath;

        // Create a unique workspace ID per script for hostPreviewService
        const scriptWorkspaceId = `${workspaceId}::${script.name}`;

        try {
          const result = await hostPreviewService.start(scriptWorkspaceId, scriptCwd, {
            script: scriptCommand,
            parentProjectPath: projectPath,
          });
          return { ok: result.ok, scriptName: script.name, error: result.error };
        } catch (error) {
          return { 
            ok: false, 
            scriptName: script.name, 
            error: error instanceof Error ? error.message : String(error) 
          };
        }
      });

      const results = await Promise.allSettled(scriptPromises);
      const failures = results
        .filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok))
        .map((r) => r.status === 'fulfilled' ? r.value.scriptName : 'unknown');

      if (failures.length === config.scripts.length) {
        const error = `All scripts failed to start: ${failures.join(', ')}`;
        this.updateState(workspaceId, { status: 'error', error });
        return { ok: false, error };
      }

      this.updateState(workspaceId, { status: 'running' });
      return { ok: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Failed to start worktree run', { workspaceId, error });
      this.updateState(workspaceId, { status: 'error', error: errorMsg });
      return { ok: false, error: errorMsg };
    }
  }

  /**
   * Stop a running worktree (stops ALL scripts)
   */
  stop(workspaceId: string): { ok: boolean } {
    const state = this.states.get(workspaceId);
    if (!state || !state.config) {
      return { ok: false };
    }

    // Stop all script instances
    let anySuccess = false;
    state.config.scripts.forEach((script) => {
      const scriptWorkspaceId = `${workspaceId}::${script.name}`;
      const result = hostPreviewService.stop(scriptWorkspaceId);
      if (result.ok) {
        anySuccess = true;
      }
    });

    if (anySuccess) {
      this.updateState(workspaceId, { status: 'stopped', previewUrl: null });
    }

    return { ok: anySuccess };
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

    // AI generation failed - return null and let user create config manually
    log.warn('AI generation failed - config must be created manually', { 
      projectPath,
      hint: 'User should create .emdash/config.json manually or use the config editor in the UI'
    });
    return null;
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
