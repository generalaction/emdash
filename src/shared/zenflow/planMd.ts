import type {
  PlanDocument,
  PlanStepData,
  WorkflowStepStatus,
  WorkflowStepType,
  ZenflowTemplateId,
} from './types';

/**
 * Regex to match zenflow step comments in plan.md.
 * Format: <!-- zenflow-step: {"stepNumber":1,...} -->
 */
const STEP_COMMENT_RE = /<!--\s*zenflow-step:\s*(\{[^}]+\})\s*-->/g;

/** Regex to match the header block (feature description + template) */
const HEADER_RE = /<!--\s*zenflow-meta:\s*(\{[^}]+\})\s*-->/;

/**
 * Parse a plan.md string into a structured PlanDocument.
 * Gracefully handles malformed or missing data.
 */
export function parsePlanMd(content: string): PlanDocument {
  // Parse header metadata
  let featureDescription = '';
  let templateId: ZenflowTemplateId = 'spec-and-build';

  const headerMatch = content.match(HEADER_RE);
  if (headerMatch) {
    try {
      const meta = JSON.parse(headerMatch[1]);
      featureDescription = meta.featureDescription || '';
      templateId = meta.templateId || 'spec-and-build';
    } catch {
      // Malformed JSON — use defaults
    }
  }

  // Parse steps
  const steps: PlanStepData[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex for global regex
  STEP_COMMENT_RE.lastIndex = 0;

  while ((match = STEP_COMMENT_RE.exec(content)) !== null) {
    try {
      const raw = JSON.parse(match[1]);
      steps.push({
        stepNumber: typeof raw.stepNumber === 'number' ? raw.stepNumber : steps.length + 1,
        name: raw.name || `Step ${steps.length + 1}`,
        type: isValidStepType(raw.type) ? raw.type : 'implementation',
        status: isValidStatus(raw.status) ? raw.status : 'pending',
        conversationId: raw.conversationId || null,
        pauseAfter: raw.pauseAfter === true,
      });
    } catch {
      // Skip malformed step comments
    }
  }

  return { featureDescription, templateId, steps };
}

/**
 * Serialize a PlanDocument to plan.md markdown string.
 */
export function writePlanMd(plan: PlanDocument): string {
  const lines: string[] = [];

  // Header metadata (hidden comment)
  lines.push(
    `<!-- zenflow-meta: ${JSON.stringify({ featureDescription: plan.featureDescription, templateId: plan.templateId })} -->`
  );
  lines.push('');
  lines.push(`# Workflow: ${plan.featureDescription}`);
  lines.push('');
  lines.push('## Steps');
  lines.push('');

  for (const step of plan.steps) {
    // Step metadata comment
    const meta: Record<string, unknown> = {
      stepNumber: step.stepNumber,
      name: step.name,
      type: step.type,
      status: step.status,
      conversationId: step.conversationId,
      pauseAfter: step.pauseAfter,
    };
    lines.push(`<!-- zenflow-step: ${JSON.stringify(meta)} -->`);

    // Human-readable checkbox line
    const checked = step.status === 'completed' ? 'x' : ' ';
    const statusLabel =
      step.status === 'running'
        ? ' *(in progress)*'
        : step.status === 'failed'
          ? ' *(failed)*'
          : '';
    lines.push(`- [${checked}] **Step ${step.stepNumber}: ${step.name}**${statusLabel}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Update a single step in plan.md content by conversationId.
 * Returns the updated markdown string.
 */
export function updateStepInPlan(
  content: string,
  conversationId: string,
  updates: Partial<PlanStepData>
): string {
  STEP_COMMENT_RE.lastIndex = 0;
  return content.replace(STEP_COMMENT_RE, (fullMatch, jsonStr: string) => {
    try {
      const raw = JSON.parse(jsonStr);
      if (raw.conversationId !== conversationId) return fullMatch;

      const updated = { ...raw, ...updates };
      return `<!-- zenflow-step: ${JSON.stringify(updated)} -->`;
    } catch {
      return fullMatch;
    }
  });
}

/**
 * Update a single step in plan.md content by stepNumber.
 * Returns the updated markdown string. Also updates the checkbox line.
 */
export function updateStepByNumber(
  content: string,
  stepNumber: number,
  updates: Partial<PlanStepData>
): string {
  // Parse, update, re-write to ensure checkbox line stays in sync
  const plan = parsePlanMd(content);
  const step = plan.steps.find((s) => s.stepNumber === stepNumber);
  if (!step) return content;

  Object.assign(step, updates);
  return writePlanMd(plan);
}

/**
 * Append new steps to the end of plan.md.
 * Returns the updated markdown string.
 */
export function addStepsToPlan(content: string, newSteps: PlanStepData[]): string {
  const plan = parsePlanMd(content);
  plan.steps.push(...newSteps);
  return writePlanMd(plan);
}

// --- Helpers ---

const VALID_STEP_TYPES: Set<string> = new Set([
  'requirements',
  'spec',
  'planning',
  'implementation',
]);

const VALID_STATUSES: Set<string> = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'paused',
]);

function isValidStepType(s: unknown): s is WorkflowStepType {
  return typeof s === 'string' && VALID_STEP_TYPES.has(s);
}

function isValidStatus(s: unknown): s is WorkflowStepStatus {
  return typeof s === 'string' && VALID_STATUSES.has(s);
}
