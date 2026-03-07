import { hostPreviewService } from '../services/hostPreviewService';
import { createRPCController } from '../../shared/ipc/rpc';
import { events } from '../_new/events';
import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import type { HostPreviewEvent } from '@shared/types/hostPreview';

export const hostPreviewController = createRPCController({
  start: async (args: {
    taskId: string;
    taskPath: string;
    script?: string;
    parentProjectPath?: string;
  }) => {
    const id = String(args?.taskId || '').trim();
    const wp = String(args?.taskPath || '').trim();
    if (!id || !wp) return { ok: false, error: 'taskId and taskPath are required' };
    return hostPreviewService.start(id, wp, {
      script: args?.script,
      parentProjectPath: args?.parentProjectPath,
    });
  },

  setup: async (args: { taskId: string; taskPath: string }) => {
    const id = String(args?.taskId || '').trim();
    const wp = String(args?.taskPath || '').trim();
    if (!id || !wp) return { ok: false, error: 'taskId and taskPath are required' };
    return hostPreviewService.setup(id, wp);
  },

  stop: async (id: string) => {
    const wid = String(id || '').trim();
    if (!wid) return { ok: true };
    return hostPreviewService.stop(wid);
  },

  stopAll: async (exceptId?: string) => {
    const ex = typeof exceptId === 'string' ? exceptId : '';
    return hostPreviewService.stopAll(ex);
  },
});

export function registerHostPreviewEvents(): void {
  hostPreviewService.onEvent((evt: HostPreviewEvent) => {
    events.emit(hostPreviewEventChannel, evt);
  });
}
