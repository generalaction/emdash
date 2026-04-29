import type { AutomationEvent } from '@shared/automations/events';

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function lookupPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function applyTemplate(template: string, event: AutomationEvent | null): string {
  if (!event) return template;
  const root: Record<string, unknown> = { event };
  return template.replace(PLACEHOLDER_RE, (match, path) => {
    const value = lookupPath(root, path);
    return value === undefined ? match : stringify(value);
  });
}
