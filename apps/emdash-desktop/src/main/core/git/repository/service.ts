import type { GitRemotesState, RepositorySelector } from '@emdash/core/runtimes/git/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import type { Unsubscribe } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire/state';
import {
  resolveProjectEffectiveSettings,
  type ProjectEffectiveSettingsSource,
  type RepoFactsSource,
} from '@core/features/projects/api/node/settings/effective-settings';
import type { ProjectRemoteState } from '@core/primitives/projects/api';
import type { GitRuntimeClient } from '@main/gateway/desktop-workers';

export class GitRepositoryService {
  constructor(
    private readonly client: GitRuntimeClient,
    private readonly selector: RepositorySelector,
    private readonly settings: ProjectEffectiveSettingsSource,
    private readonly repoFacts: RepoFactsSource
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

  /**
   * The effective base remote through the blessed resolver (spec:
   * github-git-settings §2). `null` means the repository has no remotes.
   */
  async getBaseRemote(): Promise<string | null> {
    const effective = await resolveProjectEffectiveSettings({
      settings: this.settings,
      repoFacts: this.repoFacts,
    });
    return effective.baseRemote.value;
  }

  async getRemoteState(): Promise<ProjectRemoteState> {
    try {
      const remotes = (
        await this.client.repository.model.state(this.selector, 'remotes').snapshot()
      ).data.remotes;
      const remoteName = await this.getBaseRemote();
      const remoteUrl =
        remoteName !== null ? remotes.find((r) => r.name === remoteName)?.url : undefined;
      return { hasRemote: remotes.length > 0, selectedRemoteUrl: remoteUrl ?? null };
    } catch {
      return { hasRemote: false, selectedRemoteUrl: null };
    }
  }
}
