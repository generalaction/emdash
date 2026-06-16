export type StartupDataGateStatus =
  | 'completed'
  | 'no-legacy-file'
  | 'skipped-legacy'
  | 'kept-beta'
  | 'wiped-beta';

export type StartupDataGatePhase = 'ready' | 'needs_decision' | 'running';
export type StartupDataGateScenario = 'none' | 'legacy_only' | 'beta_only' | 'both';

export type StartupDataGateAction =
  | 'import_legacy'
  | 'skip_legacy'
  | 'keep_beta'
  | 'wipe_beta'
  | 'replace_with_legacy';

export type StartupDataGateState = {
  phase: StartupDataGatePhase;
  scenario: StartupDataGateScenario;
  hasLegacyFile: boolean;
  hasBetaData: boolean;
  status: StartupDataGateStatus | null;
};

export type ResolveStartupDataGateActionArgs = {
  action: StartupDataGateAction;
};

export type ResolveStartupDataGateActionResult = {
  success: boolean;
  state: StartupDataGateState;
  error?: string;
};
