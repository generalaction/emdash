/**
 * Claude-specific ACP transcript fixture generator.
 *
 * Thin wrapper around the generic `runAcpTranscript` engine that pins the
 * provider to 'claude' and sets a default output path.
 *
 * Prerequisites — same as create-acp-transcript.ts:
 *   1. Workspace packages built (`pnpm build` from repo root).
 *   2. `claude` CLI installed and authenticated (`claude --version` should work).
 *   3. ANTHROPIC_API_KEY set in the environment.
 *
 * Usage:
 *   node --experimental-strip-types tooling/fixtures/create-claude-acp-transcript.ts
 *   # or with overrides:
 *   node --experimental-strip-types tooling/fixtures/create-claude-acp-transcript.ts \
 *     --model claude-haiku-5 \
 *     --cwd /tmp/my-clone \
 *     --out tooling/fixtures/transcripts/claude-acp-transcript.json
 */
import { runAcpTranscript } from './create-acp-transcript';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  return {
    providerId: 'claude' as const,
    model: get('--model') ?? process.env['EMDASH_FIXTURE_MODEL'] ?? 'claude-sonnet-5',
    cwd: get('--cwd') ?? process.env['EMDASH_FIXTURE_CWD'],
    out:
      get('--out') ??
      process.env['EMDASH_FIXTURE_OUT'] ??
      'tooling/fixtures/transcripts/claude-acp-transcript.json',
  };
}

const opts = parseArgs();
console.log('[fixture:claude] Starting Claude ACP transcript capture:', opts);
runAcpTranscript(opts).catch((e) => {
  console.error('[fixture:claude] Fatal error:', e);
  process.exit(1);
});
