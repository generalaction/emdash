import { humanId } from 'human-id';

export type TaskNameGenerator = (
  existingNames: Iterable<string>,
  options?: { seed?: number }
) => string;

const ADJECTIVES = [
  'curious',
  'brisk',
  'mellow',
  'vivid',
  'bright',
  'calm',
  'daring',
  'eager',
  'gentle',
  'keen',
  'lively',
  'nimble',
  'quiet',
  'rapid',
  'steady',
  'swift',
  'tidy',
  'bold',
  'clever',
  'fresh',
] as const;

const NOUNS = [
  'branch',
  'pixel',
  'thread',
  'anchor',
  'beacon',
  'circuit',
  'delta',
  'ember',
  'harbor',
  'lantern',
  'meadow',
  'moment',
  'quill',
  'signal',
  'spark',
  'stride',
  'trail',
  'vector',
  'weave',
  'whisper',
] as const;

export const MAX_TASK_NAME_LENGTH = 64;

export interface TaskNameInferenceContext {
  initialPrompt?: string | null;
  linearIssue?: { identifier?: string | null; title?: string | null } | null;
  githubIssue?: { number?: number | null; title?: string | null } | null;
  jiraIssue?: { key?: string | null; summary?: string | null } | null;
}

export const normalizeTaskName = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TASK_NAME_LENGTH);

const CONTEXT_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'for',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'as',
  'into',
  'about',
  'please',
  'help',
  'need',
  'want',
  'can',
  'could',
  'would',
  'should',
  'you',
  'your',
  'my',
  'our',
  'we',
  'i',
  'me',
  'us',
  'do',
  'does',
  'did',
  'done',
  'fix',
  'create',
  'add',
  'update',
  'make',
  'task',
]);

const stripPromptNoise = (input: string): string =>
  input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/^[-*>\d.)\s]+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const trimLeadingPromptPhrases = (input: string): string => {
  let text = input.trim();
  const leadingPatterns = [
    /^(please|kindly)\s+/i,
    /^(can|could|would)\s+you\s+/i,
    /^i\s+(need|want)\s+(you\s+to\s+)?/i,
    /^help\s+(me\s+)?(to\s+)?/i,
    /^let'?s\s+/i,
  ];
  for (const pattern of leadingPatterns) {
    text = text.replace(pattern, '');
  }
  return text.trim();
};

const extractContextKeywords = (input: string, maxWords = 6): string[] => {
  const cleaned = trimLeadingPromptPhrases(stripPromptNoise(input));
  if (!cleaned) return [];

  const words = cleaned
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => word.length > 1)
    .filter((word) => /\d/.test(word) || !CONTEXT_STOP_WORDS.has(word));

  if (words.length === 0) return [];

  const uniqueOrdered: string[] = [];
  for (const word of words) {
    if (!uniqueOrdered.includes(word)) {
      uniqueOrdered.push(word);
      if (uniqueOrdered.length >= maxWords) break;
    }
  }
  return uniqueOrdered;
};

export const ensureUniqueTaskName = (
  baseName: string,
  existingNames: Iterable<string>,
  maxAttempts = 6
): string => {
  const normalizedExisting = new Set(
    Array.from(existingNames, (name) => normalizeTaskName(name)).filter(Boolean)
  );
  const base = normalizeTaskName(baseName);
  if (base && !normalizedExisting.has(base)) return base;

  for (let i = 2; i < 2 + maxAttempts; i++) {
    const candidate = normalizeTaskName(`${baseName}-${i}`);
    if (candidate && !normalizedExisting.has(candidate)) {
      return candidate;
    }
  }

  const fallback = normalizeTaskName(`${baseName}-${Date.now().toString(36)}`);
  return fallback || base;
};

export const inferTaskNameFromContext = (
  context: TaskNameInferenceContext,
  existingNames: Iterable<string> = [],
  options?: { fallbackName?: string }
): string => {
  const contextKeywords = extractContextKeywords(context.initialPrompt || '');
  const contextName = normalizeTaskName(contextKeywords.join('-'));

  if (contextName) {
    return ensureUniqueTaskName(contextName, existingNames);
  }

  const fallback = normalizeTaskName(options?.fallbackName || '');
  if (fallback) {
    return ensureUniqueTaskName(fallback, existingNames);
  }

  return generateFriendlyTaskName(existingNames);
};

const pick = (list: readonly string[], rnd: () => number) =>
  list[Math.floor(rnd() * list.length)] || '';

const wordlistGenerator: TaskNameGenerator = (existingNames, options) => {
  const taken = new Set(
    Array.from(existingNames || [], (n) => normalizeTaskName(n)).filter(Boolean)
  );

  let currentSeed = options?.seed ?? Math.random();
  const rng = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };

  for (let i = 0; i < 8; i++) {
    const candidate = `${pick(ADJECTIVES, rng)}-${pick(NOUNS, rng)}`;
    const normalized = normalizeTaskName(candidate);
    if (normalized && !taken.has(normalized)) {
      return candidate;
    }
  }

  return 'task';
};

const humanIdGenerator: TaskNameGenerator = () => {
  // human-id already filters for SFW words; leave normalization/uniqueness to the wrapper
  return humanId({ separator: '-', capitalize: false });
};

let activeGenerator: TaskNameGenerator = humanIdGenerator;

export const setTaskNameGenerator = (generator: TaskNameGenerator | null | undefined) => {
  activeGenerator = generator || humanIdGenerator;
};

export const generateFriendlyTaskName = (
  existingNames: Iterable<string> = [],
  options?: { generator?: TaskNameGenerator; seed?: number }
): string => {
  const generator = options?.generator || activeGenerator;
  const seed = options?.seed;

  const existingArray = Array.from(existingNames || []);

  const runGenerator = (gen: TaskNameGenerator): string => {
    try {
      const raw = gen(existingArray, { seed });
      const normalized = normalizeTaskName(raw);
      if (normalized) {
        return ensureUniqueTaskName(normalized, existingArray);
      }
    } catch {
      // fall through to fallback
    }
    const fallbackRaw = wordlistGenerator(existingArray, { seed });
    return ensureUniqueTaskName(fallbackRaw, existingArray);
  };

  const primary = runGenerator(generator);
  if (primary) return primary;

  return runGenerator(wordlistGenerator);
};
