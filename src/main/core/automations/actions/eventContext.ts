import type { AutomationEvent } from '@shared/automations/events';
import { formatEventLabel } from '@shared/automations/format';

const MAX_CONTEXT_VALUE_LENGTH = 2_000;

function addLine(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value) && value.length === 0) return;
  const rendered = Array.isArray(value) ? value.join(', ') : String(value);
  const capped =
    rendered.length > MAX_CONTEXT_VALUE_LENGTH
      ? `${rendered.slice(0, MAX_CONTEXT_VALUE_LENGTH)}…`
      : rendered;
  lines.push(`- ${label}: ${capped}`);
}

export function appendAutomationEventContext(
  prompt: string,
  event: AutomationEvent | null
): string {
  if (!event) return prompt;

  const lines = [`Automation event: ${formatEventLabel(event.kind)}`];
  switch (event.kind) {
    case 'pr.opened':
    case 'pr.merged':
    case 'pr.closed':
    case 'pr.review_requested':
      addLine(lines, 'PR', `#${event.payload.number} ${event.payload.title}`);
      addLine(lines, 'URL', event.payload.url);
      addLine(lines, 'Author', event.payload.author);
      addLine(lines, 'Branch', `${event.payload.branch} → ${event.payload.baseBranch}`);
      addLine(lines, 'Ref', event.payload.ref);
      break;
    case 'ci.failed':
    case 'ci.succeeded':
      addLine(lines, 'Workflow', event.payload.workflow);
      addLine(lines, 'Conclusion', event.payload.conclusion);
      addLine(lines, 'Branch', event.payload.branch);
      addLine(lines, 'URL', event.payload.url);
      addLine(lines, 'Ref', event.payload.ref);
      break;
    case 'issue.opened':
    case 'issue.closed':
    case 'issue.assigned':
    case 'issue.commented':
      addLine(lines, 'Issue', `#${event.payload.number} ${event.payload.title}`);
      addLine(lines, 'URL', event.payload.url);
      addLine(lines, 'Author', event.payload.author);
      addLine(lines, 'Labels', event.payload.labels);
      addLine(lines, 'Assignee', event.payload.assignee);
      addLine(lines, 'Body', event.payload.body);
      addLine(lines, 'Ref', event.payload.ref);
      break;
    default: {
      const exhaustive: never = event;
      void exhaustive;
    }
  }

  return `${prompt.trim()}\n\n${lines.join('\n')}`;
}
