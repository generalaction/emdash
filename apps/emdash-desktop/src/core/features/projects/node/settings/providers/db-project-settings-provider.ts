import { emdashConfigSchema } from '@emdash/core/primitives/emdash-config/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  ProjectSettingsProvider,
  StoredPlacementSettings,
} from '@core/features/projects/api/node/settings/provider';
import {
  resolveTmux as resolveEffectiveTmux,
  type PlacementContext,
  type RepoFacts,
  type StoredBaseProjectSettings,
  type StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';
import {
  migrateAncientProjectConfig,
  type ProjectSettingsGitInspector,
} from '../migrations/ancient-project-config';
import { serializeShareableProjectSettings } from '../migrations/legacy-shareable-marker';
import {
  legacyBaseProjectSettingsSchema,
  legacyLifecycleSettingsFromStored,
  type LegacyBaseProjectSettings,
  type LegacyLifecycleSettings,
} from '../migrations/legacy-stored-project-settings';
import type { ProjectSettingsMigrationReader } from '../migrations/migration-reader';
import {
  migrateStoredBaseProjectSettings,
  readStoredProjectSettings,
  serializeStoredProjectSettings,
} from '../migrations/stored-settings';
import { compactUndefined, readJson } from '../project-settings-json';
import type { ProjectSettingsStorage, StoredProjectSettings } from '../project-settings-storage';
import { CONFIG_FILE } from '../sharing/workspace-config-file';

export type DbProjectSettingsProviderOptions = {
  git?: ProjectSettingsGitInspector;
  storage: ProjectSettingsStorage;
  /**
   * Repository facts for the lazy demote-if-matches-inference migration
   * (spec: github-git-settings §10). Absent or failing means demotion is
   * skipped this read and retried on the next one.
   */
  getRepoFacts?: () => Promise<RepoFacts | null>;
};

export abstract class DbProjectSettingsProvider
  implements ProjectSettingsProvider, ProjectSettingsMigrationReader
{
  private ancientConfigMigrationPromise: Promise<void> | undefined;

  protected constructor(
    private readonly projectId: string,
    protected readonly projectPath: string,
    /** Creation-time base ref (creation provenance); null when unknown. */
    protected readonly defaultBranchFallback: string | null,
    private readonly configFiles: FilesClientScope | undefined,
    private readonly joinProjectPath: (rootPath: string, relPath: string) => string,
    private readonly options: DbProjectSettingsProviderOptions
  ) {}

  protected abstract placementContext(): Promise<PlacementContext>;

  protected abstract validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>>;

  protected abstract normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>>;

  /**
   * New rows carry only explicit choices (spec: github-git-settings §10):
   * defaultBranch/baseRemote are no longer seeded — the branch detected at
   * creation survives only as creation provenance (`defaultBranchFallback`).
   * Tmux is also inferred from host/app layers and is no longer materialized.
   */
  protected async initialBaseProjectSettings(): Promise<StoredBaseProjectSettings> {
    return {};
  }

  private projectFilePath(relPath: string): string {
    return this.joinProjectPath(this.projectPath, relPath);
  }

  private async ensureRow(): Promise<void> {
    if (await this.options.storage.get(this.projectId)) return;

    const baseSettings = await this.initialBaseProjectSettings();
    // No built-in preserve defaults (spec: workspace-lifecycle-v2): new projects
    // start with empty shareable settings; preservePatterns is a deliberate choice.
    await this.options.storage.insertIfMissing(this.projectId, {
      baseProjectSettingsJson: JSON.stringify(compactUndefined(baseSettings)),
      shareableProjectSettingsJson: serializeShareableProjectSettings({}),
      legacyConfigMigratedAt: null,
    });
  }

  private async readSettingsRow(placementContext?: PlacementContext): Promise<{
    stored: StoredBaseProjectSettings;
    legacyLifecycle: LegacyLifecycleSettings;
  }> {
    await this.ensureRow();
    const row = await this.options.storage.get(this.projectId);
    if (!row) {
      const stored = await this.initialBaseProjectSettings();
      return {
        stored,
        legacyLifecycle: {},
      };
    }
    const rawBase = readJson(
      row.baseProjectSettingsJson,
      legacyBaseProjectSettingsSchema,
      'base project settings'
    );
    // Host/repository I/O happens before entering the storage transaction.
    const context = await this.loadMigrationContext(rawBase, placementContext);
    let current = row;
    try {
      current = await this.options.storage.mutate(this.projectId, (latest) =>
        this.migrateRow(latest, context)
      );
    } catch (error) {
      log.warn('Failed to write back migrated project settings; retrying next read', {
        projectId: this.projectId,
        error,
      });
      current = (await this.options.storage.get(this.projectId)) ?? row;
      current = { ...current, ...this.migrateRow(current, context) };
    }
    return {
      stored: readStoredProjectSettings(current.baseProjectSettingsJson),
      legacyLifecycle: this.legacyLifecycleFromRow(current),
    };
  }

  private legacyLifecycleFromRow(row: StoredProjectSettings): LegacyLifecycleSettings {
    return legacyLifecycleSettingsFromStored(
      readJson(
        row.baseProjectSettingsJson,
        legacyBaseProjectSettingsSchema,
        'base project settings'
      ),
      readJson(
        row.shareableProjectSettingsJson,
        emdashConfigSchema,
        'legacy shareable project settings'
      )
    );
  }

  private async loadMigrationContext(
    raw: LegacyBaseProjectSettings,
    placementContext?: PlacementContext
  ) {
    const needsFacts =
      raw.defaultBranch !== undefined || raw.baseRemote !== undefined || raw.remote !== undefined;
    const [repoFacts, placement] = await Promise.all([
      needsFacts ? this.loadRepoFacts() : null,
      raw.tmuxDefaultMigrated !== true ? (placementContext ?? this.placementContext()) : null,
    ]);
    return {
      repoFacts,
      tmuxDefault: placement
        ? resolveEffectiveTmux({
            hostTmux: placement.hostTmux,
            appDefaultTmux: placement.appDefaultTmux,
          }).value
        : undefined,
    };
  }

  private migrateRow(
    row: StoredProjectSettings,
    context: { repoFacts: RepoFacts | null; tmuxDefault?: boolean },
    finalize = false
  ): Partial<StoredProjectSettings> {
    const raw = readJson(
      row.baseProjectSettingsJson,
      legacyBaseProjectSettingsSchema,
      'base project settings'
    );
    const { next } = migrateStoredBaseProjectSettings(raw, context.repoFacts, context);
    const base = finalize
      ? JSON.stringify(compactUndefined(next))
      : serializeStoredProjectSettings(next, row.baseProjectSettingsJson);
    const shareable = finalize
      ? serializeShareableProjectSettings({}, { previousRaw: row.shareableProjectSettingsJson })
      : row.shareableProjectSettingsJson;
    return {
      ...(base !== row.baseProjectSettingsJson ? { baseProjectSettingsJson: base } : {}),
      ...(shareable !== row.shareableProjectSettingsJson
        ? { shareableProjectSettingsJson: shareable }
        : {}),
    };
  }

  private async loadRepoFacts(): Promise<RepoFacts | null> {
    if (!this.options.getRepoFacts) return null;
    try {
      return await this.options.getRepoFacts();
    } catch (error) {
      log.warn('Failed to load repo facts for settings migration; skipping demotion', {
        projectId: this.projectId,
        error,
      });
      return null;
    }
  }

  async migrateAncientConfig(git = this.options.git): Promise<void> {
    if (this.ancientConfigMigrationPromise) {
      await this.ancientConfigMigrationPromise;
      return;
    }

    this.ancientConfigMigrationPromise = (async () => {
      await this.ensureRow();
      const row = await this.options.storage.get(this.projectId);
      await migrateAncientProjectConfig({
        projectId: this.projectId,
        row,
        configFiles: this.configFiles,
        configPath: this.projectFilePath(CONFIG_FILE),
        defaultBranchFallback: this.defaultBranchFallback,
        storage: this.options.storage,
        git,
        normalizeStoredWorktreeDirectory: (worktreeDirectory) =>
          this.normalizeStoredWorktreeDirectory(worktreeDirectory),
      });
    })();

    try {
      await this.ancientConfigMigrationPromise;
    } catch (error) {
      this.ancientConfigMigrationPromise = undefined;
      throw error;
    }
  }

  async ensure(): Promise<void> {
    await this.ensureRow();
  }

  async readLegacyLifecycleSettings(): Promise<LegacyLifecycleSettings> {
    return (await this.readSettingsRow()).legacyLifecycle;
  }

  async finalizeLegacyLifecycleSettings(): Promise<void> {
    await this.ensureRow();
    const row = await this.options.storage.get(this.projectId);
    if (!row) return;
    const rawBase = readJson(
      row.baseProjectSettingsJson,
      legacyBaseProjectSettingsSchema,
      'base project settings'
    );
    const context = await this.loadMigrationContext(rawBase);
    await this.options.storage.mutate(this.projectId, (current) =>
      this.migrateRow(current, context, true)
    );
  }

  /**
   * The stored git settings in the new model (spec: github-git-settings §2):
   * only explicit user choices, absence = infer. This is the resolver input;
   * adoption code should consume this instead of the legacy `get()` view.
   */
  async getStoredGitSettings(): Promise<StoredProjectGitSettings> {
    const { stored } = await this.readSettingsRow();
    return {
      ...(stored.defaultBranch !== undefined ? { defaultBranch: stored.defaultBranch } : {}),
      ...(stored.baseRemote !== undefined ? { baseRemote: stored.baseRemote } : {}),
      ...(stored.pushRemote !== undefined ? { pushRemote: stored.pushRemote } : {}),
      ...(stored.agentGitCredentials !== undefined
        ? { agentGitCredentials: stored.agentGitCredentials }
        : {}),
      ...(stored.worktreeRoot !== undefined ? { worktreeRoot: stored.worktreeRoot } : {}),
    };
  }

  async getStoredIntegrationAccounts() {
    return (await this.readSettingsRow()).stored.integrationAccounts ?? {};
  }

  async getStoredPlacementSettings(): Promise<StoredPlacementSettings> {
    const { stored } = await this.readSettingsRow();
    return stored.tmux === undefined ? {} : { tmux: stored.tmux };
  }

  async setWorktreeRoot(
    worktreeRoot: string | null
  ): Promise<Result<void, UpdateProjectSettingsError>> {
    try {
      const validated = await this.validateWorktreeDirectory(worktreeRoot ?? undefined);
      if (!validated.success) return validated;
      await this.readSettingsRow();
      await this.options.storage.mutate(this.projectId, (row) => {
        const next = readStoredProjectSettings(row.baseProjectSettingsJson);
        if (validated.data === undefined) delete next.worktreeRoot;
        else next.worktreeRoot = validated.data;
        return {
          baseProjectSettingsJson: serializeStoredProjectSettings(
            next,
            row.baseProjectSettingsJson
          ),
        };
      });
      return ok();
    } catch (error) {
      log.warn('Failed to set Project worktree root', { error });
      return err({ type: 'error' });
    }
  }

  async getPlacementContext(): Promise<PlacementContext> {
    return this.placementContext();
  }

  async resolveTmux() {
    const placement = await this.placementContext();
    const { stored } = await this.readSettingsRow(placement);
    return resolveEffectiveTmux({
      projectTmux: stored.tmux,
      hostTmux: placement.hostTmux,
      appDefaultTmux: placement.appDefaultTmux,
    });
  }
}
