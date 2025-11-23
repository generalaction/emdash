import { humanId } from 'human-id';

export type WorkspaceNameGenerator = (
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

export const MAX_WORKSPACE_NAME_LENGTH = 64;

export const normalizeWorkspaceName = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_WORKSPACE_NAME_LENGTH);

export const ensureUniqueWorkspaceName = (
  baseName: string,
  existingNames: Iterable<string>,
  maxAttempts = 6
): string => {
  const normalizedExisting = new Set(
    Array.from(existingNames, (name) => normalizeWorkspaceName(name)).filter(Boolean)
  );
  const base = normalizeWorkspaceName(baseName);
  if (base && !normalizedExisting.has(base)) return base;

  for (let i = 2; i < 2 + maxAttempts; i++) {
    const candidate = normalizeWorkspaceName(`${baseName}-${i}`);
    if (candidate && !normalizedExisting.has(candidate)) {
      return candidate;
    }
  }

  const fallback = normalizeWorkspaceName(`${baseName}-${Date.now().toString(36)}`);
  return fallback || base;
};

const pick = (list: readonly string[], rnd: () => number) =>
  list[Math.floor(rnd() * list.length)] || '';

const wordlistGenerator: WorkspaceNameGenerator = (existingNames, options) => {
  const taken = new Set(
    Array.from(existingNames || [], (n) => normalizeWorkspaceName(n)).filter(Boolean)
  );

  let currentSeed = options?.seed ?? Math.random();
  const rng = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };

  for (let i = 0; i < 8; i++) {
    const candidate = `${pick(ADJECTIVES, rng)}-${pick(NOUNS, rng)}`;
    const normalized = normalizeWorkspaceName(candidate);
    if (normalized && !taken.has(normalized)) {
      return candidate;
    }
  }

  return 'workspace';
};

const humanIdGenerator: WorkspaceNameGenerator = () => {
  // human-id already filters for SFW words; leave normalization/uniqueness to the wrapper
  return humanId({ separator: '-', capitalize: false });
};

let activeGenerator: WorkspaceNameGenerator = humanIdGenerator;

export const setWorkspaceNameGenerator = (generator: WorkspaceNameGenerator | null | undefined) => {
  activeGenerator = generator || humanIdGenerator;
};

export const generateFriendlyWorkspaceName = (
  existingNames: Iterable<string> = [],
  options?: { generator?: WorkspaceNameGenerator; seed?: number }
): string => {
  const generator = options?.generator || activeGenerator;
  const seed = options?.seed;

  const existingArray = Array.from(existingNames || []);

  const runGenerator = (gen: WorkspaceNameGenerator): string => {
    try {
      const raw = gen(existingArray, { seed });
      const normalized = normalizeWorkspaceName(raw);
      if (normalized) {
        return ensureUniqueWorkspaceName(normalized, existingArray);
      }
    } catch {
      // fall through to fallback
    }
    const fallbackRaw = wordlistGenerator(existingArray, { seed });
    return ensureUniqueWorkspaceName(fallbackRaw, existingArray);
  };

  const primary = runGenerator(generator);
  if (primary) return primary;

  return runGenerator(wordlistGenerator);
};
