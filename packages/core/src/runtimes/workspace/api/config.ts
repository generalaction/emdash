import type { LegacyWorkspaceAutomation } from './schemas';

export type LegacyWorkspaceScriptSettings = {
  setup?: string;
  run?: string;
  teardown?: string;
};

export type NormalizeLegacyWorkspaceAutomationInput = {
  scripts?: LegacyWorkspaceScriptSettings;
  shellSetup?: string;
  autoRunSetup?: boolean;
  autoRunRun?: boolean;
};

export function normalizeLegacyWorkspaceAutomation(
  input: NormalizeLegacyWorkspaceAutomationInput
): LegacyWorkspaceAutomation | undefined {
  const automation = {
    setup: normalizeScript(input.scripts?.setup),
    run: normalizeScript(input.scripts?.run),
    teardown: normalizeScript(input.scripts?.teardown),
    shellSetup: normalizeScript(input.shellSetup),
    autoRunSetup: input.autoRunSetup ?? true,
    autoRunRun: input.autoRunRun ?? false,
  } satisfies LegacyWorkspaceAutomation;

  if (!automation.setup && !automation.run && !automation.teardown && !automation.shellSetup) {
    return undefined;
  }

  return automation;
}

function normalizeScript(script: string | undefined): string | undefined {
  const trimmed = script?.trim();
  return trimmed ? script : undefined;
}
