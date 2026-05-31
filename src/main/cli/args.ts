/**
 * Minimal, dependency-free argv parser for the emdash CLI.
 *
 * Supports `--flag`, `--key value`, `--key=value`, short `-k value`, and bare
 * positionals. Intentionally tiny — we don't pull in commander/yargs to avoid
 * lockfile churn for a local-only tool.
 */

export type ParsedArgs = {
  positionals: string[];
  options: Record<string, string | boolean>;
};

/** Flags that never take a value (presence === true). */
const BOOLEAN_FLAGS = new Set([
  'json',
  'include-archived',
  'push',
  'no-worktree',
  'checkout-existing',
  'auto-approve',
  'push-branch',
  'force',
  'skip-hook',
  'help',
]);

/** Flags that always take a value — so a value beginning with '-' is consumed, not misread as a flag. */
const VALUE_FLAGS = new Set([
  'project',
  'branch',
  'base',
  'name',
  'message',
  'agent',
  'id',
  'pre-remove',
  'prompt',
]);

const SHORT_ALIASES: Record<string, string> = {
  p: 'project',
  b: 'branch',
  m: 'message',
  h: 'help',
};

function normalizeKey(raw: string): string {
  return SHORT_ALIASES[raw] ?? raw;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--') || token.startsWith('-')) {
      const isLong = token.startsWith('--');
      const body = token.slice(isLong ? 2 : 1);
      const eqIdx = body.indexOf('=');

      if (eqIdx !== -1) {
        const key = normalizeKey(body.slice(0, eqIdx));
        options[key] = body.slice(eqIdx + 1);
        continue;
      }

      const key = normalizeKey(body);
      if (BOOLEAN_FLAGS.has(key)) {
        options[key] = true;
        continue;
      }

      const next = argv[i + 1];
      // Known value-flags always consume the next token (even if it starts with
      // '-', e.g. a message or branch literally beginning with a dash).
      if (VALUE_FLAGS.has(key)) {
        if (next === undefined || next === '--') {
          options[key] = true;
        } else {
          options[key] = next;
          i++;
        }
        continue;
      }

      // Unknown flag: consume the next token as a value unless it looks like another flag.
      if (next === undefined || next.startsWith('-')) {
        options[key] = true;
      } else {
        options[key] = next;
        i++;
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, options };
}

/** Reads a string option, returning undefined when absent or boolean-only. */
export function getString(args: ParsedArgs, key: string): string | undefined {
  const value = args.options[key];
  return typeof value === 'string' ? value : undefined;
}

/** Reads a boolean flag (presence or `--key=true`). */
export function getBool(args: ParsedArgs, key: string): boolean {
  const value = args.options[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'false' && value !== '0';
  return false;
}
