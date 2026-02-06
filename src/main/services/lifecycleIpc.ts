import { ipcMain } from 'electron';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import { log } from '../lib/logger';
import { LIFECYCLE_PHASES } from '@shared/lifecycle';

export function registerLifecycleIpc(): void {
  // Get a specific lifecycle phase script for a project
  ipcMain.handle(
    'lifecycle:getScript',
    async (
      _event,
      args: {
        projectPath: string;
        phase: string;
      }
    ) => {
      try {
        if (!LIFECYCLE_PHASES.includes(args.phase as (typeof LIFECYCLE_PHASES)[number])) {
          return { success: false, error: `Invalid lifecycle phase: ${args.phase}` };
        }
        const phase = args.phase as (typeof LIFECYCLE_PHASES)[number];
        const script = lifecycleScriptsService.getScript(args.projectPath, phase);
        return { success: true, script };
      } catch (error) {
        log.error('Failed to get lifecycle script:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
