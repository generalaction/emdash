import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';

export interface EmdashScripts {
  setup?: string;
}

export interface EmdashConfig {
  preservePatterns?: string[];
  scripts?: EmdashScripts;
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
   * Get the setup script command if configured
   */
  getSetupScript(projectPath: string): string | null {
    const config = this.readConfig(projectPath);
    return config?.scripts?.setup || null;
  }
}

export const lifecycleScriptsService = new LifecycleScriptsService();
