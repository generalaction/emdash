import type { AutomationEvent } from '@shared/automations/events';

const TEMPLATE_RE = /{{\s*([^{}]+?)\s*}}/g;
const MAX_VALUE_LENGTH = 4_000;

function getPathValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const rendered = Array.isArray(value) ? value.join(', ') : String(value);
  return rendered.length > MAX_VALUE_LENGTH ? `${rendered.slice(0, MAX_VALUE_LENGTH)}…` : rendered;
}

export function applyAutomationTemplate(input: string, event: AutomationEvent | null): string {
  if (!event || !input.includes('{{')) return input;
  return input.replace(TEMPLATE_RE, (match, expression: string) => {
    const path = expression.trim();
    if (!path.startsWith('event.')) return match;
    return stringifyTemplateValue(getPathValue({ event }, path));
  });
}

export function eventIssueRef(event: AutomationEvent | null): string | null {
  if (!event) return null;
  if (
    event.kind === 'issue.opened' ||
    event.kind === 'issue.closed' ||
    event.kind === 'issue.assigned' ||
    event.kind === 'issue.commented'
  ) {
    return event.payload.ref || event.payload.number;
  }
  return null;
}

export function eventPrRef(event: AutomationEvent | null): string | null {
  if (!event) return null;
  if (
    event.kind === 'pr.opened' ||
    event.kind === 'pr.merged' ||
    event.kind === 'pr.closed' ||
    event.kind === 'pr.review_requested'
  ) {
    return event.payload.ref || String(event.payload.number);
  }
  return null;
}
