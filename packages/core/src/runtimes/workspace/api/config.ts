import type { LegacyWorkspaceAutomation } from './schemas';

export type LegacyWorkspaceScriptSettings = {
  prepare?: string;
  setup?: string;
  run?: string;
  teardown?: string;
};

export type NormalizeLegacyWorkspaceAutomationInput = {
  scripts?: LegacyWorkspaceScriptSettings;
  shellSetup?: string;
  env?: Record<string, string>;
  autoRunSetup?: boolean;
  autoRunRun?: boolean;
};

export function normalizeLegacyWorkspaceAutomation(
  input: NormalizeLegacyWorkspaceAutomationInput
): LegacyWorkspaceAutomation | undefined {
  const automation = {
    prepare: normalizeScript(input.scripts?.prepare),
    setup: normalizeScript(input.scripts?.setup),
    run: normalizeScript(input.scripts?.run),
    teardown: normalizeScript(input.scripts?.teardown),
    shellSetup: normalizeScript(input.shellSetup),
    ...(input.env && Object.keys(input.env).length > 0 && { env: input.env }),
    autoRunSetup: input.autoRunSetup ?? true,
    autoRunRun: input.autoRunRun ?? false,
  } satisfies LegacyWorkspaceAutomation;

  if (
    !automation.prepare &&
    !automation.setup &&
    !automation.run &&
    !automation.teardown &&
    !automation.shellSetup
  ) {
    return undefined;
  }

  return automation;
}

function normalizeScript(script: string | undefined): string | undefined {
  const trimmed = script?.trim();
  return trimmed ? script : undefined;
}
