import type { ChatItem, ChatRole, ToolStatus } from './model';

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

const TOOL_NAMES = ['read_file', 'write_file', 'run_command', 'search'];

/**
 * Generate `count` ChatItems (default 6000) alternating user / assistant
 * messages with occasional tool calls. Deterministic given `seed`.
 *
 * IDs are stable (`msg-0`, `tool-3`, …) which matters because HeightModel's
 * cache and ViewStateStore are keyed off `${messageId}#${index}` block IDs.
 */
export function generateMockTranscript(count = 6000, seed = 1): ChatItem[] {
  const rng = makeRng(seed);
  const items: ChatItem[] = [];

  for (let i = 0; i < count; i++) {
    // ~every 7th item is a tool call
    if (i % 7 === 3) {
      const statuses: ToolStatus[] = ['done', 'done', 'done', 'error'];
      const status = statuses[Math.floor(rng() * statuses.length)];
      items.push({
        kind: 'tool',
        id: `tool-${i}`,
        name: TOOL_NAMES[Math.floor(rng() * TOOL_NAMES.length)],
        status,
        inputSummary: `packages/ui/src/chat/${words(rng, 1, 3).toLowerCase().replace(/ /g, '-')}.ts`,
        detail: status === 'error' ? words(rng, 5, 12) : undefined,
      });
      continue;
    }

    const role: ChatRole = i % 2 === 0 ? 'user' : 'assistant';
    items.push({
      kind: 'message',
      id: `msg-${i}`,
      role,
      text: role === 'user' ? words(rng, 4, 16) + '?' : bodyFor(rng, i),
    });
  }

  return items;
}
