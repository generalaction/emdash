import type { LoopPhaseKind, LoopTerminalGates } from '@shared/core/loops/loops';

export type LoopWorkPhaseDraft = {
  id: string;
  kind: 'work';
  name: string;
  goal: string;
};

export type LoopTerminalPhaseDraft = {
  id: string;
  kind: Exclude<LoopPhaseKind, 'work'>;
  name: string;
  goal: string;
};

export type LoopPlanPhaseDraft = LoopWorkPhaseDraft | LoopTerminalPhaseDraft;

export type LoopPlanDraft = {
  enabled: boolean;
  goal: string;
  planSource: string;
  workPhases: LoopWorkPhaseDraft[];
  terminalGates: LoopTerminalGates;
};

type NormalizeLoopPlanInput = {
  goal: string;
  planSource: string;
  terminalGates?: LoopTerminalGates;
};

type ParsedPhase = {
  name: string;
  body: string[];
};

const defaultTerminalGates: LoopTerminalGates = { review: false, e2e: false };

function workPhase(id: number, name: string, goal: string): LoopWorkPhaseDraft {
  return {
    id: `work-${id}`,
    kind: 'work',
    name,
    goal,
  };
}

export function createDefaultLoopPlanDraft(): LoopPlanDraft {
  return {
    enabled: false,
    goal: '',
    planSource: '',
    workPhases: [workPhase(1, 'Phase 1', '')],
    terminalGates: { ...defaultTerminalGates },
  };
}

function markerText(line: string): string | null {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  if (heading?.[1]?.trim()) return heading[1].trim();

  const numbered = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(line);
  if (numbered?.[1]?.trim()) return numbered[1].trim();

  const checkbox = /^\s*[-*+]\s+\[[ xX]\]\s+(.+?)\s*$/.exec(line);
  return checkbox?.[1]?.trim() || null;
}

function parseStructuredPhases(planSource: string): LoopWorkPhaseDraft[] {
  const parsed: ParsedPhase[] = [];
  let current: ParsedPhase | null = null;
  let fence: '```' | '~~~' | null = null;

  const finishCurrent = (): void => {
    if (!current) return;
    parsed.push(current);
    current = null;
  };

  for (const rawLine of planSource.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    const fenceMarker = trimmed.startsWith('```')
      ? '```'
      : trimmed.startsWith('~~~')
        ? '~~~'
        : null;

    if (fenceMarker) {
      if (current) current.body.push(line.trimEnd());
      fence = fence === fenceMarker ? null : (fence ?? fenceMarker);
      continue;
    }

    const name = fence ? null : markerText(line);
    if (name) {
      finishCurrent();
      current = { name, body: [] };
      continue;
    }

    if (current) current.body.push(line.trimEnd());
  }
  finishCurrent();

  return parsed.map((phase, index) => {
    const body = phase.body.join('\n').trim();
    return workPhase(index + 1, phase.name, body || phase.name);
  });
}

export function normalizeLoopPlan(input: NormalizeLoopPlanInput): LoopPlanDraft {
  const goal = input.goal.trim();
  const structured = parseStructuredPhases(input.planSource);
  return {
    enabled: true,
    goal,
    planSource: input.planSource,
    workPhases: structured.length > 0 ? structured : [workPhase(1, 'Phase 1', goal)],
    terminalGates: { ...(input.terminalGates ?? defaultTerminalGates) },
  };
}

export function orderedLoopPlanPhases(draft: LoopPlanDraft): LoopPlanPhaseDraft[] {
  const phases: LoopPlanPhaseDraft[] = [...draft.workPhases];
  if (draft.terminalGates.review) {
    phases.push({
      id: 'review',
      kind: 'review',
      name: 'Review',
      goal: 'Review the complete change and correct any issues.',
    });
  }
  if (draft.terminalGates.e2e) {
    phases.push({
      id: 'e2e',
      kind: 'e2e',
      name: 'E2E',
      goal: 'Verify the completed change independently in a clean workspace.',
    });
  }
  return phases;
}

export function validateLoopPlanDraft(draft: LoopPlanDraft): string[] {
  if (!draft.enabled) return [];

  const errors: string[] = [];
  if (!draft.goal.trim()) errors.push('Add a goal for this Loop.');
  if (draft.workPhases.length === 0) errors.push('Add at least one work phase.');
  for (const [index, phase] of draft.workPhases.entries()) {
    const label = phase.name.trim() || `Phase ${index + 1}`;
    if (!phase.name.trim()) errors.push(`Name ${label}.`);
    if (!phase.goal.trim()) errors.push(`Describe what ${label} should complete.`);
  }
  return errors;
}
