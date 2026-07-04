import {
  VERIFIER_IDS,
  type CreateLoopParams,
  type LoopProviderId,
  type LoopVerifierAvailability,
  type VerifierId,
} from '@shared/core/loops/loops';

export type DraftCriterion = {
  id: string;
  description: string;
  verifier: VerifierId;
};

export type DraftPhase = {
  id: string;
  name: string;
  goal: string;
  criteria: DraftCriterion[];
};

export type DraftAgentBrowserConfig = {
  targetUrl: string;
  cdpPort: string;
};

export const defaultVerifier = VERIFIER_IDS[0];

export function makeCriterion(verifier: VerifierId = defaultVerifier): DraftCriterion {
  return {
    id: crypto.randomUUID(),
    description: '',
    verifier,
  };
}

export function makePhase(index: number, verifier: VerifierId = defaultVerifier): DraftPhase {
  return {
    id: crypto.randomUUID(),
    name: `Phase ${index + 1}`,
    goal: '',
    criteria: [makeCriterion(verifier)],
  };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item) next.splice(to, 0, item);
  return next;
}

function parsedCdpPort(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedAgentBrowserConfig(
  selectedVerifiers: Set<VerifierId>,
  agentBrowser: DraftAgentBrowserConfig
): CreateLoopParams['agentBrowser'] {
  if (!selectedVerifiers.has('agent-browser')) return undefined;

  const targetUrl = agentBrowser.targetUrl.trim();
  const cdpPort = parsedCdpPort(agentBrowser.cdpPort);
  return {
    ...(targetUrl ? { targetUrl } : {}),
    ...(typeof cdpPort === 'number' ? { cdpPort } : {}),
  };
}

export function validationError(input: {
  name: string;
  phases: DraftPhase[];
  validationCommands: string[];
  selectedVerifiers: Set<VerifierId>;
  availability: LoopVerifierAvailability[];
  agentBrowser: DraftAgentBrowserConfig;
}): string | null {
  if (!input.name.trim()) return 'Loop name is required.';
  if (input.selectedVerifiers.size === 0) return 'Select at least one verifier.';
  const unavailable = input.availability.find(
    (item) => input.selectedVerifiers.has(item.id) && !item.available
  );
  if (unavailable) {
    return `${unavailable.label} is unavailable: ${unavailable.reason ?? 'Unavailable'}`;
  }
  if (
    input.selectedVerifiers.has('agent-browser') &&
    parsedCdpPort(input.agentBrowser.cdpPort) === null
  ) {
    return 'CDP port must be a positive integer.';
  }
  if (input.validationCommands.every((command) => !command.trim())) {
    return 'Add at least one validation command.';
  }
  if (input.phases.length === 0) return 'Add at least one phase.';

  for (const phase of input.phases) {
    if (!phase.name.trim()) return 'Every phase needs a name.';
    if (!phase.goal.trim()) return 'Every phase needs a goal.';
    const criteria = phase.criteria.filter((criterion) => criterion.description.trim());
    if (criteria.length === 0) return 'Every phase needs at least one pass criterion.';
    const missingVerifier = criteria.find(
      (criterion) => !input.selectedVerifiers.has(criterion.verifier)
    );
    if (missingVerifier) {
      return 'Each criterion verifier must be selected for the loop.';
    }
  }

  return null;
}

export function buildCreateLoopParams(input: {
  projectId: string;
  taskId: string;
  name: string;
  provider?: LoopProviderId;
  planSource: string;
  validationCommands: string[];
  selectedVerifiers: Set<VerifierId>;
  reviewEnabled: boolean;
  phases: DraftPhase[];
  agentBrowser: DraftAgentBrowserConfig;
}): CreateLoopParams {
  const agentBrowser = normalizedAgentBrowserConfig(input.selectedVerifiers, input.agentBrowser);
  return {
    projectId: input.projectId,
    taskId: input.taskId,
    name: input.name.trim(),
    ...(input.provider ? { provider: input.provider } : {}),
    planSource: input.planSource.trim(),
    validationCommands: input.validationCommands.map((command) => command.trim()).filter(Boolean),
    verifiers: Array.from(input.selectedVerifiers),
    reviewEnabled: input.reviewEnabled,
    phases: input.phases.map((phase, index) => ({
      name: phase.name.trim() || `Phase ${index + 1}`,
      goal: phase.goal.trim(),
      criteria: phase.criteria
        .filter((criterion) => criterion.description.trim())
        .map((criterion) => ({
          description: criterion.description.trim(),
          verifier: criterion.verifier,
        })),
    })),
    ...(agentBrowser ? { agentBrowser } : {}),
  };
}
