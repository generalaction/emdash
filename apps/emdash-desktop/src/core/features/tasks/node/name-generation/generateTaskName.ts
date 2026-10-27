import { randomInt } from 'node:crypto';
import { generateBranchName } from 'nbranch';

const MAX_TASK_NAME_LENGTH = 64;

export const TASK_NAME_VERBS = [
  'add',
  'fix',
  'refactor',
  'tune',
  'patch',
  'harden',
  'migrate',
  'wire',
  'cleanup',
  'optimize',
  'debug',
  'rework',
  'extract',
  'cache',
  'validate',
  'ship',
];
export const TASK_NAME_SCOPES = [
  'api',
  'auth',
  'ui',
  'db',
  'cache',
  'cart',
  'checkout',
  'webhook',
  'sync',
  'search',
  'session',
  'config',
  'router',
  'build',
  'store',
  'theme',
];
export const TASK_NAME_NOUNS = [
  'handler',
  'flow',
  'query',
  'schema',
  'layout',
  'hook',
  'service',
  'client',
  'parser',
  'guard',
  'worker',
  'pipeline',
  'endpoint',
  'state',
  'logger',
  'module',
];

function pick(words: readonly string[]): string {
  return words[randomInt(words.length)];
}

function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TASK_NAME_LENGTH);
}

export function generateRandom(): string {
  return `${pick(TASK_NAME_VERBS)}-${pick(TASK_NAME_SCOPES)}-${pick(TASK_NAME_NOUNS)}`;
}

function generateFromInput(title: string, description?: string): string {
  const input = description ? `${title}\n\n${description}` : title;
  const raw = generateBranchName(input, {
    addRandomSuffix: false,
    separator: '-',
    maxLength: MAX_TASK_NAME_LENGTH,
  });
  return sanitize(raw);
}

export function generateTaskName(params: { title?: string; description?: string }): string {
  const { title, description } = params;
  if (title && title.trim().length > 0) {
    return generateFromInput(title.trim(), description?.trim());
  }
  return generateRandom();
}
