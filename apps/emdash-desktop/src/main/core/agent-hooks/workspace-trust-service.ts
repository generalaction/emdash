import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { claudeTrustService } from './claude-trust-service';
import { cursorTrustService } from './cursor-trust-service';
import { piTrustService } from './pi-trust-service';

type WorkspaceTrustLocalArgs = {
  providerId: AgentProviderId;
  cwd?: string;
  homedir: string;
  force?: boolean;
};

type WorkspaceTrustSshArgs = {
  providerId: AgentProviderId;
  cwd?: string;
  ctx: IExecutionContext;
  remoteFs: Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>;
  force?: boolean;
};

type WorkspaceTrustProvider = {
  maybeAutoTrustLocal(args: WorkspaceTrustLocalArgs): Promise<void>;
  maybeAutoTrustSsh(args: WorkspaceTrustSshArgs): Promise<void>;
};

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
  piTrustService,
]);
