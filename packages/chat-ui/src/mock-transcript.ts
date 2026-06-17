import type { ChatItem, ChatRole, FileOpKind, ToolStatus } from './model';

/** Tiny deterministic PRNG (mulberry32) so stories render identically each time. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
  'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud ' +
  'exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute'
).split(' ');

function words(rng: () => number, min: number, max: number): string {
  const n = min + Math.floor(rng() * (max - min + 1));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rng() * WORDS.length)]);
  const s = out.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CODE_SAMPLE = [
  '```typescript',
  'function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  'console.log(add(2, 3));',
  '```',
].join('\n');

const TABLE_SAMPLE = [
  '| Block | Strategy |',
  '|-------|----------|',
  '| prose | pretext  |',
  '| code  | line-count |',
  '| island | DOM measure |',
].join('\n');

/** Build a markdown body whose shape varies by index to exercise every block tier. */
function bodyFor(rng: () => number, i: number): string {
  const variant = i % 6;
  switch (variant) {
    case 0:
      return words(rng, 8, 40) + '.';
    case 1:
      return `## ${words(rng, 2, 5)}\n\n${words(rng, 20, 60)}.`;
    case 2:
      return [
        words(rng, 5, 15) + ':',
        '',
        `- ${words(rng, 3, 8)}`,
        `- ${words(rng, 3, 8)}`,
        `- ${words(rng, 3, 8)}`,
      ].join('\n');
    case 3:
      return `${words(rng, 6, 18)}.\n\n${CODE_SAMPLE}`;
    case 4:
      return `> ${words(rng, 8, 24)}.`;
    default:
      return `${words(rng, 6, 18)}.\n\n${TABLE_SAMPLE}`;
  }
}

/** Thinking text — multi-paragraph reasoning block. */
function thinkingText(rng: () => number): string {
  return [
    words(rng, 15, 40) + '.',
    '',
    words(rng, 20, 50) + '.',
    '',
    `- ${words(rng, 5, 12)}`,
    `- ${words(rng, 5, 12)}`,
    `- ${words(rng, 5, 12)}`,
  ].join('\n');
}

const FILE_PATHS = [
  'packages/chat-ui/src/components/execute/Execute.tsx',
  'packages/chat-ui/src/components/file-op/FileOperation.tsx',
  'apps/emdash-desktop/src/renderer/features/tasks/conversations/chat/chat-store.ts',
  'packages/ui/src/theme/theme.css',
  'packages/chat-ui/src/state/transcript.ts',
  'apps/emdash-desktop/src/main/core/acp/acp-session-manager.ts',
  'packages/chat-ui/src/model.ts',
  'packages/chat-ui/src/components/thinking/Thinking.tsx',
];

const COMMANDS = [
  'ls -la',
  'pnpm run test',
  'pnpm run build',
  'find . -name "*.ts" -type f',
  'git diff --stat HEAD~1',
  'pnpm --filter @emdash/chat-ui run typecheck',
];

const GENERIC_TOOL_NAMES = ['search', 'fetch_url', 'think', 'web.run'];
const GENERIC_TOOL_SUMMARIES = [
  'emdash SolidJS component patterns',
  'https://solidjs.com/docs/latest',
  'how to implement a virtualized list',
  'latest ACP protocol specification',
];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate a deterministic mix of ChatItems covering every current renderer:
 * user messages, thinking (with + without duration), file-op (single + multi),
 * execute (with + without duration, occasional error), and generic tool rows.
 *
 * All rows have terminal status so the perf stories don't spin live timers.
 * IDs are stable (`msg-0`, `exec-4`, …) — the height cache and ViewStateStore
 * are keyed by item id.
 *
 * The 10-item cycle is:
 *   0 user message
 *   1 thinking done
 *   2 file-op single read
 *   3 assistant message (varied markdown)
 *   4 execute done/error
 *   5 file-op multi edit (2-4 paths)
 *   6 generic tool
 *   7 assistant message (varied markdown)
 *   8 file-op delete or move
 *   9 assistant message (code/table heavy)
 */
export function generateMockTranscript(count = 6000, seed = 1): ChatItem[] {
  const rng = makeRng(seed);
  const items: ChatItem[] = [];

  const CYCLE = 10;

  for (let i = 0; i < count; i++) {
    const slot = i % CYCLE;

    if (slot === 0) {
      // ── user message ─────────────────────────────────────────────────────
      items.push({
        kind: 'message',
        id: `msg-${i}`,
        role: 'user' as ChatRole,
        text: words(rng, 4, 16) + '?',
      });
    } else if (slot === 1) {
      // ── thinking done ────────────────────────────────────────────────────
      const hasDuration = rng() > 0.2; // ~80% have durationMs, ~20% omit (exercises optional)
      items.push({
        kind: 'thinking',
        id: `think-${i}`,
        status: 'done',
        text: thinkingText(rng),
        startedAt: 0,
        ...(hasDuration ? { durationMs: 1000 + Math.floor(rng() * 9000) } : {}),
      });
    } else if (slot === 2) {
      // ── file-op single read ───────────────────────────────────────────────
      items.push({
        kind: 'file-op',
        id: `fo-${i}`,
        op: 'read' as FileOpKind,
        status: 'done' as ToolStatus,
        ops: [{ path: pick(rng, FILE_PATHS) }],
      });
    } else if (slot === 3) {
      // ── assistant message (prose / heading / list / code / quote / table) ─
      items.push({
        kind: 'message',
        id: `msg-${i}`,
        role: 'assistant' as ChatRole,
        text: bodyFor(rng, i),
      });
    } else if (slot === 4) {
      // ── execute done (occasional error, ~20% no duration) ─────────────────
      const isError = rng() < 0.1;
      const hasDuration = rng() > 0.2;
      items.push({
        kind: 'execute',
        id: `exec-${i}`,
        command: pick(rng, COMMANDS),
        status: isError ? 'error' : ('done' as ToolStatus),
        startedAt: 0,
        ...(hasDuration ? { durationMs: 500 + Math.floor(rng() * 4500) } : {}),
      });
    } else if (slot === 5) {
      // ── file-op multi edit ───────────────────────────────────────────────
      const opCount = 2 + Math.floor(rng() * 3); // 2-4 paths
      const ops = Array.from({ length: opCount }, () => ({ path: pick(rng, FILE_PATHS) }));
      items.push({
        kind: 'file-op',
        id: `fo-${i}`,
        op: 'edit' as FileOpKind,
        status: 'done' as ToolStatus,
        ops,
      });
    } else if (slot === 6) {
      // ── generic tool (search / fetch_url / think / web.run) ──────────────
      items.push({
        kind: 'tool',
        id: `tool-${i}`,
        name: pick(rng, GENERIC_TOOL_NAMES),
        status: 'done' as ToolStatus,
        inputSummary: pick(rng, GENERIC_TOOL_SUMMARIES),
      });
    } else if (slot === 7) {
      // ── assistant message (varied markdown, different phase from slot 3) ──
      items.push({
        kind: 'message',
        id: `msg-${i}`,
        role: 'assistant' as ChatRole,
        text: bodyFor(rng, i + 3), // offset so variant differs from slot 3
      });
    } else if (slot === 8) {
      // ── file-op delete or move ────────────────────────────────────────────
      const op: FileOpKind = rng() < 0.5 ? 'delete' : 'move';
      items.push({
        kind: 'file-op',
        id: `fo-${i}`,
        op,
        status: 'done' as ToolStatus,
        ops: [{ path: pick(rng, FILE_PATHS) }],
      });
    } else {
      // slot === 9: assistant message (code/table heavy)
      items.push({
        kind: 'message',
        id: `msg-${i}`,
        role: 'assistant' as ChatRole,
        text: bodyFor(rng, i + 3), // biased toward code/table variants
      });
    }
  }

  return items;
}
