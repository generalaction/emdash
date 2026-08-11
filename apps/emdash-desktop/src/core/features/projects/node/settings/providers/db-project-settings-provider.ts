import { emdashConfigSchema } from '@emdash/core/primitives/emdash-config/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  ProjectSettingsPatch,
  ProjectSettingsProvider,
} from '@core/features/projects/api/node/settings/provider';
import {
  baseProjectSettingsSchema,
  legacyBaseProjectSettingsSchema,
  projectSettingsSchema,
  type BaseProjectSettings,
  type ProjectSettings,
  type RepoFacts,
  type ShareableProjectSettings,
  type StoredBaseProjectSettings,
  type StoredProjectGitSettings,
  type WorktreeRootContext,
} from '@core/primitives/project-settings/api';
import { SHAREABLE_FIELD_ACCESSORS } from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';
import {
  migrateLegacyProjectSettingsIfNeeded,
  type ProjectSettingsGitInspector,
} from '../legacy-project-settings-migration';
import { serializeShareableProjectSettings } from '../legacy-shareable-migration-marker';
import { compactUndefined, readJson } from '../project-settings-json';
import type { ProjectSettingsStorage } from '../project-settings-storage';
import { CONFIG_FILE } from '../sharing/workspace-config-file';
import {
  legacyBaseSettingsToStored,
  migrateStoredBaseProjectSettings,
  toLegacyBaseSettingsView,
} from '../stored-settings-migration';

export type DbProjectSettingsProviderOptions = {
  git?: ProjectSettingsGitInspector;
  getProjectDefaults(): Promise<{ tmuxByDefault: boolean }>;
  storage: ProjectSettingsStorage;
  /**
   * Repository facts for the lazy demote-if-matches-inference migration
   * (spec: github-git-settings §10). Absent or failing means demotion is
   * skipped this read and retried on the next one.
   */
  getRepoFacts?: () => Promise<RepoFacts | null>;
  /**
   * Migration 5: one-time move of the app-wide defaultWorktreeDirectory into
   * the local host default. Injected because it needs app settings and the
   * local host-settings runtime, which this provider must not depend on.
   */
  migrateAppWorktreeRoot?: () => Promise<void>;
};

export abstract class DbProjectSettingsProvider implements ProjectSettingsProvider {
  private legacyMigrationPromise: Promise<void> | undefined;
  private appWorktreeRootMigrated = false;

  protected constructor(
    private readonly projectId: string,
    protected readonly projectPath: string,
    protected readonly defaultBranchFallback: string = 'main',
    private readonly configFiles: FilesClientScope | undefined,
    private readonly joinProjectPath: (rootPath: string, relPath: string) => string,
    private readonly options: DbProjectSettingsProviderOptions
  ) {}

  protected abstract worktreeRootContext(): Promise<WorktreeRootContext>;

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
   * Only the tmux default is still materialized.
   */
  protected async initialBaseProjectSettings(): Promise<StoredBaseProjectSettings> {
    const projectDefaults = await this.options.getProjectDefaults();
    return { tmux: projectDefaults.tmuxByDefault };
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

  private async readSettingsRow(): Promise<{
    base: BaseProjectSettings;
    stored: StoredBaseProjectSettings;
    shareable: ShareableProjectSettings;
    legacyConfigMigratedAt: string | null;
  }> {
    await this.ensureRow();
    await this.migrateLegacyConfigIfNeeded();
    await this.migrateAppWorktreeRootIfNeeded();
    const row = await this.options.storage.get(this.projectId);
    if (!row) {
      const stored = await this.initialBaseProjectSettings();
      return {
        base: toLegacyBaseSettingsView(stored),
        stored,
        shareable: {},
        legacyConfigMigratedAt: null,
      };
    }
    const raw = readJson(
      row.baseProjectSettingsJson,
      legacyBaseProjectSettingsSchema,
      'base project settings'
    );
    const stored = await this.migrateStoredModelIfNeeded(raw);

    return {
      base: toLegacyBaseSettingsView(stored),
      stored,
      shareable: withoutRetiredShellSetup(
        readJson(row.shareableProjectSettingsJson, emdashConfigSchema, 'shareable project settings')
      ),
      legacyConfigMigratedAt: row.legacyConfigMigratedAt,
    };
  }

  /**
   * Lazy read-path migrations (spec: github-git-settings §10): converts a raw
   * row to the stored model and writes the migrated row back when it changed.
   * A failed write-back degrades to the in-memory migrated view and retries
   * on the next read.
   */
  private async migrateStoredModel(
    raw: ReturnType<typeof legacyBaseProjectSettingsSchema.parse>
  ): Promise<{ next: StoredBaseProjectSettings; changed: boolean }> {
    const needsFacts =
      raw.defaultBranch !== undefined || raw.baseRemote !== undefined || raw.remote !== undefined;
    const repoFacts = needsFacts ? await this.loadRepoFacts() : null;
    return migrateStoredBaseProjectSettings(raw, repoFacts);
  }

  private async migrateStoredModelIfNeeded(
    raw: ReturnType<typeof legacyBaseProjectSettingsSchema.parse>
  ): Promise<StoredBaseProjectSettings> {
    const { next, changed } = await this.migrateStoredModel(raw);
    if (changed) {
      try {
        await this.options.storage.update(this.projectId, {
          baseProjectSettingsJson: JSON.stringify(compactUndefined(next)),
        });
      } catch (error) {
        log.warn('Failed to write back migrated project settings; retrying next read', {
          projectId: this.projectId,
          error,
        });
      }
    }
    return next;
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

  private async migrateAppWorktreeRootIfNeeded(): Promise<void> {
    if (this.appWorktreeRootMigrated || !this.options.migrateAppWorktreeRoot) return;
    try {
      await this.options.migrateAppWorktreeRoot();
      this.appWorktreeRootMigrated = true;
    } catch (error) {
      log.warn('App worktree-root migration failed; retrying next read', {
        projectId: this.projectId,
        error,
      });
    }
  }

  private async migrateLegacyConfigIfNeeded(git = this.options.git): Promise<void> {
    if (this.legacyMigrationPromise) {
      await this.legacyMigrationPromise;
      return;
    }

    this.legacyMigrationPromise = (async () => {
      const row = await this.options.storage.get(this.projectId);
      await migrateLegacyProjectSettingsIfNeeded({
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
      await this.legacyMigrationPromise;
    } catch (error) {
      this.legacyMigrationPromise = undefined;
      throw error;
    }
  }

  async ensure(options: Pick<DbProjectSettingsProviderOptions, 'git'> = {}): Promise<void> {
    await this.ensureRow();
    await this.migrateLegacyConfigIfNeeded(options.git);
  }

  async get(): Promise<ProjectSettings> {
    const { base, shareable } = await this.readSettingsRow();
    return projectSettingsSchema.parse({ ...base, ...shareable });
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
      ...(stored.githubAccount !== undefined ? { githubAccount: stored.githubAccount } : {}),
      ...(stored.worktreeRoot !== undefined ? { worktreeRoot: stored.worktreeRoot } : {}),
    };
  }

  async update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const parsed = projectSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      return err({ type: 'invalid-settings' });
    }

    const nextSettings = parsed.data;
    const worktreeDirectoryResult = await this.validateWorktreeDirectory(
      nextSettings.worktreeDirectory
    );
    if (!worktreeDirectoryResult.success) {
      return worktreeDirectoryResult;
    }
    nextSettings.worktreeDirectory = worktreeDirectoryResult.data;

    const base = legacyBaseSettingsToStored(baseProjectSettingsSchema.parse(nextSettings));
    const shareable = withoutRetiredShellSetup(emdashConfigSchema.parse(nextSettings));

    try {
      await this.ensure();
      const row = await this.options.storage.get(this.projectId);
      await this.options.storage.update(this.projectId, {
        baseProjectSettingsJson: JSON.stringify(compactUndefined(base)),
        shareableProjectSettingsJson: serializeShareableProjectSettings(shareable, {
          previousRaw: row?.shareableProjectSettingsJson,
        }),
      });
      return ok();
    } catch (error) {
      log.warn('Failed to update project settings', { error });
      return err({ type: 'error' });
    }
  }

  async patch(patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>> {
    try {
      await this.ensure();
      const row = await this.options.storage.get(this.projectId);
      const base = row
        ? (
            await this.migrateStoredModel(
              readJson(
                row.baseProjectSettingsJson,
                legacyBaseProjectSettingsSchema,
                'base project settings'
              )
            )
          ).next
        : await this.initialBaseProjectSettings();
      const shareable = row
        ? withoutRetiredShellSetup(
            readJson(
              row.shareableProjectSettingsJson,
              emdashConfigSchema,
              'shareable project settings'
            )
          )
        : {};

      for (const field of patch.clearShareableFields ?? []) {
        SHAREABLE_FIELD_ACCESSORS[field].clear(shareable);
      }

      const nextBase: StoredBaseProjectSettings = { ...base };
      if (Object.hasOwn(patch, 'githubAccountId')) {
        if (patch.githubAccountId === undefined) {
          delete nextBase.githubAccount;
        } else {
          nextBase.githubAccount =
            patch.githubAccountId === null
              ? { kind: 'none' }
              : { kind: 'account', accountId: patch.githubAccountId };
        }
      }

      await this.options.storage.update(this.projectId, {
        baseProjectSettingsJson: JSON.stringify(compactUndefined(nextBase)),
        shareableProjectSettingsJson: serializeShareableProjectSettings(shareable, {
          previousRaw: row?.shareableProjectSettingsJson,
        }),
      });
      return ok();
    } catch (error) {
      log.warn('Failed to clear shareable project settings', { error });
      return err({ type: 'error' });
    }
  }

  async getWorktreeRootContext(): Promise<WorktreeRootContext> {
    return this.worktreeRootContext();
  }
}

/**
 * shellSetup was retired from project settings (spec: activation-scripts-via-terminals):
 * the host-settings runtime owns the per-host default and workspace `.emdash.json`
 * overrides it. Stored DB values are ignored on read and dropped on the next write —
 * a deliberate breaking change with no migration.
 */
function withoutRetiredShellSetup(shareable: ShareableProjectSettings): ShareableProjectSettings {
  if (shareable.shellSetup === undefined) return shareable;
  const { shellSetup: _retired, ...rest } = shareable;
  return rest;
}
