import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { sampleOnce } from './resource-sampler';

export const resourceMonitorController = createRPCController({
  /** One-shot sample of current PTY resource usage. */
  getSnapshot: async () => {
    const { enabled } = await appSettingsService.get('resourceMonitor');
    if (!enabled) return ok(null);
    return ok(await sampleOnce());
  },

  pauseSession: (sessionId: string) => {
    try {
      const result = ptySessionRegistry.pause(sessionId);
      if (result === 'not_found') return err({ type: 'not_found' as const });
      if (result === 'unsupported') return err({ type: 'unsupported' as const });
      return ok();
    } catch (error) {
      return err({ type: 'pause_failed' as const, message: String(error) });
    }
  },

  resumeSession: (sessionId: string) => {
    try {
      const result = ptySessionRegistry.resume(sessionId);
      if (result === 'not_found') return err({ type: 'not_found' as const });
      if (result === 'unsupported') return err({ type: 'unsupported' as const });
      return ok();
    } catch (error) {
      return err({ type: 'resume_failed' as const, message: String(error) });
    }
  },
});
