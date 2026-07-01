import { claudeTrustService } from './claude-trust-service';
import { cursorTrustService } from './cursor-trust-service';
import type {
  WorkspaceTrustLocalArgs,
  WorkspaceTrustProvider,
  WorkspaceTrustSshArgs,
} from './workspace-trust-types';

export class WorkspaceTrustService {
  constructor(private readonly providers: readonly WorkspaceTrustProvider[]) {}

  async maybeAutoTrustLocal(args: WorkspaceTrustLocalArgs): Promise<void> {
    for (const provider of this.providers) {
      await provider.maybeAutoTrustLocal(args);
    }
  }

  async maybeAutoTrustSsh(args: WorkspaceTrustSshArgs): Promise<void> {
    for (const provider of this.providers) {
      await provider.maybeAutoTrustSsh(args);
    }
  }
}

export const workspaceTrustService = new WorkspaceTrustService([
  claudeTrustService,
  cursorTrustService,
]);
