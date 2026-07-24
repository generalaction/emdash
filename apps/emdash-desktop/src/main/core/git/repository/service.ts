import type { GitRemotesState, RepositorySelector } from '@emdash/core/runtimes/git/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import type { Unsubscribe } from '@emdash/shared';
import { ReplicaState } from '@emdash/wire';
import { resolveConfiguredRemotes } from '@core/primitives/git/api';
import type { ProjectSettings } from '@core/primitives/project-settings/api';
import type { ProjectRemoteState } from '@core/primitives/projects/api';
import type { GitRuntimeClient } from '@main/gateway/desktop-workers';

type GitRepositorySettingsProvider = {
  get(): Promise<ProjectSettings>;
};

export class GitRepositoryService {
  constructor(
    private readonly client: GitRuntimeClient,
    private readonly selector: RepositorySelector,
    private readonly settings: GitRepositorySettingsProvider
  ) {}

  subscribeRemotes(cb: (update: GitRemotesState) => void): Unsubscribe {
    let active = true;
    const replica = new ReplicaState(this.client.repository.model.state(this.selector, 'remotes'), {
      schema: gitContract.repository.model.states.remotes.dataSchema,
    });
    const binding = replica.ready.then(() => {
      if (!active) return null;
      return replica.onChange(cb);
    });
    return () => {
      active = false;
      void binding
        .then((unsubscribe) => unsubscribe?.())
        .finally(() => {
          void replica.dispose();
        });
    };
  }

  async getConfiguredRemotes(): Promise<{ baseRemote: string; pushRemote: string }> {
    const [settings, remotes] = await Promise.all([
      this.settings.get().catch(() => undefined),
      this.client.repository.model
        .state(this.selector, 'remotes')
        .snapshot()
        .then((snapshot) => snapshot.data)
        .catch(() => ({ remotes: [] })),
    ]);
    const configured = resolveConfiguredRemotes(settings, remotes.remotes);
    return {
      baseRemote: configured.baseRemote.name,
      pushRemote: configured.pushRemote.name,
    };
  }

  async getBaseRemote(): Promise<string> {
    return (await this.getConfiguredRemotes()).baseRemote;
  }

  async getRemoteState(): Promise<ProjectRemoteState> {
    try {
      const remotes = (
        await this.client.repository.model.state(this.selector, 'remotes').snapshot()
      ).data.remotes;
      const remoteName = await this.getBaseRemote();
      const remoteUrl = remotes.find((r) => r.name === remoteName)?.url;
      return { hasRemote: remotes.length > 0, selectedRemoteUrl: remoteUrl ?? null };
    } catch {
      return { hasRemote: false, selectedRemoteUrl: null };
    }
  }
}
