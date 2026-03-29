import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import type { IntegrationId, IntegrationStatusMap } from '../../shared/integrations/types';

async function checkGitHub(): Promise<boolean> {
  try {
    const { githubService } = await import('../services/GitHubService');
    return await githubService.isAuthenticated();
  } catch {
    return false;
  }
}

async function checkLinear(): Promise<boolean> {
  try {
    const { default: LinearService } = await import('../services/LinearService');
    const linear = new LinearService();
    return !!(await linear.checkConnection()).connected;
  } catch {
    return false;
  }
}

async function checkJira(): Promise<boolean> {
  try {
    const { default: JiraService } = await import('../services/JiraService');
    const jira = new JiraService();
    return !!(await jira.checkConnection()).connected;
  } catch {
    return false;
  }
}

async function checkGitLab(): Promise<boolean> {
  try {
    const { GitLabService } = await import('../services/GitLabService');
    const gitlab = new GitLabService();
    return !!(await gitlab.checkConnection()).success;
  } catch {
    return false;
  }
}

async function checkPlain(): Promise<boolean> {
  try {
    const { default: PlainService } = await import('../services/PlainService');
    const plain = new PlainService();
    return !!(await plain.checkConnection()).connected;
  } catch {
    return false;
  }
}

async function checkForgejo(): Promise<boolean> {
  try {
    const { ForgejoService } = await import('../services/ForgejoService');
    const forgejo = new ForgejoService();
    return !!(await forgejo.checkConnection()).success;
  } catch {
    return false;
  }
}

async function checkSentry(): Promise<boolean> {
  try {
    const { sentryService } = await import('../services/SentryService');
    return !!(await sentryService.checkConnection()).connected;
  } catch {
    return false;
  }
}

const checkers: Record<IntegrationId, () => Promise<boolean>> = {
  github: checkGitHub,
  linear: checkLinear,
  jira: checkJira,
  gitlab: checkGitLab,
  plain: checkPlain,
  forgejo: checkForgejo,
  sentry: checkSentry,
};

export function registerIntegrationsIpc(): void {
  ipcMain.handle('integrations:statusMap', async () => {
    try {
      const ids = Object.keys(checkers) as IntegrationId[];
      const results = await Promise.all(ids.map((id) => checkers[id]()));
      const data = {} as IntegrationStatusMap;
      ids.forEach((id, i) => {
        data[id] = results[i];
      });
      return { success: true, data };
    } catch (error) {
      log.error('Failed to get integration status map:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
