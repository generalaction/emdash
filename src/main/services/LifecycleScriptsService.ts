import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';
import type { LifecyclePhase, LifecycleScriptConfig } from '@shared/lifecycle';

export interface EmdashConfig {
  preservePatterns?: string[];
  scripts?: LifecycleScriptConfig;
}

/**
 * Manages lifecycle scripts for worktrees.
 * Scripts are configured in .emdash.json at the project root.
 */
class LifecycleScriptsService {
  /**
   * Read .emdash.json config from project root
   */
  readConfig(projectPath: string): EmdashConfig | null {
    try {
      const configPath = path.join(projectPath, '.emdash.json');
      if (!fs.existsSync(configPath)) {
        return null;
      }
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content) as EmdashConfig;
    } catch (error) {
      log.warn('Failed to read .emdash.json', { projectPath, error });
      return null;
    }
  }

  /**
   * Get all configured lifecycle scripts for a project.
   */
  getScripts(projectPath: string): LifecycleScriptConfig | null {
    const config = this.readConfig(projectPath);
    return config?.scripts ?? null;
  }

  /**
   * Get a specific lifecycle script command if configured.
   */
  getScript(projectPath: string, phase: LifecyclePhase): string | null {
    const scripts = this.getScripts(projectPath);
    const script = scripts?.[phase];
    return typeof script === 'string' && script.trim().length > 0 ? script.trim() : null;
  }

  /**
   * Compatibility wrapper for existing setup-only call sites.
   */
  getSetupScript(projectPath: string): string | null {
    return this.getScript(projectPath, 'setup');
  }
}

export const lifecycleScriptsService = new LifecycleScriptsService();
