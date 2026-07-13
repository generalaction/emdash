import type { Emitter, Result } from '@emdash/shared';
import type {
  DependencyStatus,
  InstallMethod,
  InstallOption,
  Platform,
  ProbeResult,
  UninstallStrategy,
  UpdatesDescriptor,
  UpdateStrategy,
} from './capability';

export type DependencyCategory = 'core' | 'agent';

export type DependencyId = string;

export interface DependencyState {
  id: DependencyId;
  category: DependencyCategory;
  status: DependencyStatus;
  version: string | null;
  path: string | null;
  checkedAt: number;
  error?: string;
  latestVersion?: string | null;
  updateAvailable?: boolean;
}

export type DependencyStatusMap = Record<string, DependencyState>;

export type InstallCommandError =
  | { type: 'permission-denied'; message: string; output: string; exitCode?: number }
  | { type: 'command-failed'; message: string; output: string; exitCode?: number }
  | { type: 'pty-open-failed'; message: string };

export type DependencyInstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-install-command'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-install'; id: string };

export type DependencyInstallResult = Result<DependencyState, DependencyInstallError>;

export type DependencyUpdateError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-update-strategy'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-update'; id: string };

export type DependencyUpdateResult = Result<DependencyState, DependencyUpdateError>;

export type DependencyUninstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-uninstall-strategy'; id: string }
  | { type: 'no-uninstall-command'; id: string }
  | { type: 'still-present'; id: string }
  | InstallCommandError;

export type DependencyUninstallResult = Result<DependencyState, DependencyUninstallError>;

export type Provenance = {
  kind: InstallMethod | 'manual' | 'version-manager' | 'unknown';
  confidence: 'confirmed' | 'inferred';
  managerRef?: string;
};

export type InstallOverride =
  | { kind: 'pinned'; realpath: string }
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string };

export type SelectedSource = { kind: 'auto' } | InstallOverride;

export type Installation = {
  id: string;
  realpath: string;
  pathEntry: string | null;
  isActive: boolean;
  manageable: boolean;
  provenance: Provenance;
  status: DependencyStatus;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

export type HostDependency = {
  hostId: string;
  dependencyId: DependencyId;
  installations: Installation[];
  used: SelectedSource;
};

export type HostDependencySelection = InstallOverride | null;

export type DependencyStatusUpdatedEvent = {
  id: string;
  state: DependencyState;
  connectionId?: string;
  hostDependency?: HostDependency;
};

export interface DependencyDescriptor {
  id: DependencyId;
  name: string;
  category: DependencyCategory;
  /** Binary names to try in order; first success wins. */
  commands: string[];
  /** Args passed when probing for a version string. Defaults to ['--version']. */
  versionArgs?: string[];
  /** Skip executing the CLI after resolving its path. */
  skipVersionProbe?: boolean;
  docUrl?: string;
  /** Per-platform install options from plugin metadata. */
  installCommands?: Partial<Record<Platform, InstallOption[]>>;
  /** Optional imperative hooks from the provider implementation. */
  commandHooks?: {
    resolveLatestVersion?(): Promise<string | null>;
    buildUpdateCommand?(binaryPath: string): { command: string; args: string[] };
    buildUninstallCommand?(binaryPath: string): { command: string; args: string[] };
  };
  /** Override the default status resolution logic. */
  resolveStatus?: (result: ProbeResult) => DependencyStatus;
  /** Updates capability from plugin metadata. Absent for core dependencies. */
  updates?: UpdatesDescriptor;
  /** Uninstall strategy from plugin metadata. Absent for core dependencies. */
  uninstall?: UninstallStrategy;
}

export type DependencyProbeOptions = {
  refreshShellEnv?: boolean;
};

export type HostDependencyRunOptions = {
  run?: (command: string) => Promise<Result<void, InstallCommandError>>;
};

export interface HostDependencyManagerPort {
  readonly platform: Platform;
  readonly onStatusUpdated: Emitter<DependencyStatusUpdatedEvent>;
  readonly onExecutableInvalidated?: Emitter<{ id: DependencyId }>;
  initialize(): void;
  getAll(): Map<DependencyId, DependencyState>;
  get(id: DependencyId): DependencyState | undefined;
  getByCategory(cat: DependencyCategory): DependencyState[];
  getHostDependency(id: DependencyId): HostDependency | undefined;
  probe(id: DependencyId): Promise<DependencyState>;
  probeCategory(cat: DependencyCategory, options?: DependencyProbeOptions): Promise<void>;
  getInstallOptions(id: DependencyId): InstallOption[];
  install(
    id: DependencyId,
    method?: InstallMethod,
    options?: HostDependencyRunOptions
  ): Promise<DependencyInstallResult>;
  uninstall(
    id: DependencyId,
    method?: InstallMethod,
    options?: HostDependencyRunOptions
  ): Promise<DependencyUninstallResult>;
}

export type { DependencyStatus, ProbeResult };
export type {
  InstallMethod,
  InstallOption,
  Platform,
  UninstallStrategy,
  UpdatesDescriptor,
  UpdateStrategy,
};
