import { rpc } from '@renderer/lib/ipc';
import { Resource } from './resource';

export type AppInfo = {
  platform: string;
  appVersion: string;
  electronVersion: string;
};

export class AppInfoStore {
  readonly info: Resource<AppInfo>;

  constructor() {
    this.info = new Resource<AppInfo>(
      () =>
        Promise.all([
          rpc.app.getPlatform(),
          rpc.app.getAppVersion(),
          rpc.app.getElectronVersion(),
        ]).then(([platform, appVersion, electronVersion]) => ({
          platform,
          appVersion,
          electronVersion,
        })),
      [] // no strategy — explicitly loaded at startup
    );
  }

  load(): Promise<void> {
    return this.info.load();
  }
}
