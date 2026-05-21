import type { ProviderClassifier } from '@main/core/agent-hooks/classifiers/base';

/**
 * Narrow I/O capabilities injected into a plugin at task-creation time.
 * Scoped to one task: project-root and user-home are baked into the closures
 * by the orchestration layer, so plugins never deal with absolute paths.
 */
export interface ProviderPluginDeps {
  /** Read a file relative to the worktree root. Returns undefined if absent. */
  readProjectFile(relPath: string): Promise<string | undefined>;
  /** Write a file relative to the worktree root. */
  writeProjectFile(relPath: string, content: string): Promise<void>;

  /** Read a file relative to the user home directory. Returns undefined if absent. */
  readUserFile(relPath: string): Promise<string | undefined>;
  /** Write a file relative to the user home directory. */
  writeUserFile(relPath: string, content: string): Promise<void>;

  /** OS platform — for generating curl vs PowerShell hook commands. */
  platform: NodeJS.Platform;
}

/**
 * Per-provider behavior plugin. Contains only runtime behavior — all static
 * provider data (CLI flags, icons, descriptions) lives in the shared registry.
 */
export interface ProviderPlugin {
  /**
   * PTY output classifier. Omit to use the generic fallback classifier.
   * Only active when hooks are unavailable (CLI not found, SSH session, etc.).
   */
  createClassifier?(): ProviderClassifier;

  /**
   * Write provider-specific hook config files.
   * CLI availability is checked by the orchestration layer before calling this —
   * the plugin can assume the CLI exists.
   * Returns true if hook config was successfully written.
   *
   * Uses I/O capabilities closed over from ProviderPluginDeps at factory time.
   */
  writeHookConfig?(): Promise<boolean>;

  /**
   * Project-relative paths to add to .gitignore after writeHookConfig() returns true.
   * The orchestration layer performs the actual gitignore update.
   * Omit for providers that write config to the user home directory (e.g. Codex).
   */
  readonly gitIgnorePaths?: readonly string[];

  /**
   * When true, skip the PTY output classifier in favour of hook-based events,
   * provided the CLI is available and writeHookConfig() returned true.
   */
  readonly supportsHooks?: boolean;

  /**
   * Pre-spawn setup (e.g. trust file writes, one-time registration).
   * Called before the PTY is created on every session start.
   * Implementations must be idempotent.
   *
   * Receives raw paths only — plugins that need file I/O in this phase
   * manage it themselves (e.g. node:fs with atomic writes).
   */
  prepareSession?(ctx: { projectPath: string; homedir: string }): Promise<void>;
}

export type ProviderPluginFactory = (deps: ProviderPluginDeps) => ProviderPlugin;

/**
 * Define a provider plugin via a factory that receives scoped I/O capabilities.
 * The factory is called once per task context, binding the project path and
 * home dir into dep closures.
 *
 * This function is an identity wrapper — its value is type inference and
 * making the pattern explicit to readers.
 */
export function createProviderPlugin(factory: ProviderPluginFactory): ProviderPluginFactory {
  return factory;
}
