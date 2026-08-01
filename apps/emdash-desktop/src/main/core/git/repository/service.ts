import type { GitRemotesState, RepositorySelector } from '@emdash/core/runtimes/git/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import type { Unsubscribe } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire';
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
    const scope = createScope({ label: 'git-repository-remotes' });
    const repository = remote(gitContract.repository.model, this.client.repository.model, {
      scope,
      lingerMs: 15_000,
    });
    observe(
      repository(this.selector).states.remotes,
      (snapshot) => {
        if (snapshot.value) cb(snapshot.value);
      },
      { scope }
    );
    return () => {
      void scope.dispose();
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
