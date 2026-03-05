import { browserViewService } from '../services/browserViewService';
import { createRPCController } from '../../shared/ipc/rpc';

export const browserController = createRPCController({
  show: (_args: { x: number; y: number; width: number; height: number; url?: string }) => {
    const { x, y, width, height, url } = _args || ({} as any);
    browserViewService.show({ x, y, width, height }, url);
    return { ok: true };
  },

  hide: () => {
    browserViewService.hide();
    return { ok: true };
  },

  setBounds: (_args: { x: number; y: number; width: number; height: number }) => {
    const { x, y, width, height } = _args || ({} as any);
    browserViewService.setBounds({ x, y, width, height });
    return { ok: true };
  },

  loadURL: (url: string, forceReload?: boolean) => {
    browserViewService.loadURL(url, forceReload);
    return { ok: true };
  },

  goBack: () => {
    browserViewService.goBack();
    return { ok: true };
  },

  goForward: () => {
    browserViewService.goForward();
    return { ok: true };
  },

  reload: () => {
    browserViewService.reload();
    return { ok: true };
  },

  openDevTools: () => {
    browserViewService.openDevTools();
    return { ok: true };
  },

  clear: () => {
    browserViewService.clear();
    return { ok: true };
  },
});
