import { humanId } from 'human-id';
import { generateBranchName } from 'nbranch';

const MAX_TASK_NAME_LENGTH = 64;

function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TASK_NAME_LENGTH);
}

export function generateRandom(): string {
  return sanitize(humanId({ separator: '-', capitalize: false }));
}

// nbranch transliterates to ASCII and drops non-Latin scripts entirely
// (e.g. Japanese input collapses to a generic "feat-unknown"), so
// non-Latin titles are slugified directly instead of going through it.
const NON_LATIN_PATTERN = /[^\x00-\x7f]/;

function generateFromInput(title: string, description?: string): string {
  if (NON_LATIN_PATTERN.test(title)) {
    return sanitize(title) || generateRandom();
  }
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
