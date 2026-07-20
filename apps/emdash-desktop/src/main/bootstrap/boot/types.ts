import type { SshServiceHandle } from '@core/services/ssh/node';
import type { AppConfig } from '../core/config';

export type BootContext = {
  readonly config: AppConfig;
  windowPhaseReady: boolean;
  ssh: SshServiceHandle | undefined;
};

export class BootAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootAborted';
  }
}

export function isBootAborted(error: unknown): error is BootAborted {
  return error instanceof BootAborted;
}
