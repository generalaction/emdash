# Usage Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Usage" view to emdash showing deduplicated token/cost analytics for Claude Code and Codex, parsed from local transcript files.

**Architecture:** A new main-process domain `src/main/core/usage-stats/` (pure parsers + pricing + aggregation, an incremental on-disk cache, and a singleton service exposed via RPC) feeds a renderer view `src/renderer/features/usage/` built like `library-view` (left rail: Overview / Costs) with dependency-free SVG charts via React Query.

**Tech Stack:** TypeScript, Electron main/renderer, `@shared/ipc/rpc` (typed RPC), `@shared/result` (`Result`), `@tanstack/react-query`, Vitest (`node` + `browser` projects), Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-05-31-usage-stats-design.md`

**Conventions reused:** controller→operations→singleton service (`agents/conventions/main-patterns.md`); `ok()`/`err()` from `@shared/result`; view registration in `src/renderer/app/view-registry.ts`; data via React Query (`agents/conventions/renderer-patterns.md`).

**Running a single test:** `pnpm vitest run --project node <path>` (main/pure) or `--project browser` (renderer).
**Merge gate (run before final commit):** `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test`.

---

## File Structure

**Shared**
- Create `src/shared/usage.ts` — IPC contract types + `EMPTY_USAGE_SNAPSHOT`.

**Main — `src/main/core/usage-stats/`**
- `types.ts` — internal `UsageRecord`, `ScannedFile`.
- `pricing.ts` — model→family normalize, rates, `costOf`.
- `parse-claude.ts` — Claude transcript → `UsageRecord[]`.
- `parse-codex.ts` — Codex rollout → `UsageRecord[]`.
- `aggregate.ts` — `UsageRecord[]` → `UsageSnapshot` (global dedup).
- `scanner.ts` — walk `~/.claude` + `~/.codex` → `ScannedFile[]`.
- `cache.ts` — load/save versioned file-index JSON in `userData`.
- `usage-stats-service.ts` — singleton orchestration; `initialize()`, `getSnapshot()`, `refresh()`.
- `operations.ts` — thin RPC operation functions.
- `controller.ts` — `createRPCController`.
- Colocated `*.test.ts` for `pricing`, `parse-claude`, `parse-codex`, `aggregate`, `scanner`, `cache`.

**Main — edits**
- `src/main/rpc.ts` — register `usageStats: usageStatsController`.
- `src/main/index.ts` — call `usageStatsService.initialize()`.

**Renderer — `src/renderer/features/usage/`**
- `format.ts` (+ test) — `fmtTokens`, `fmtUsd`, `fmtCompact`.
- `components/{StatCard,BarRow,Sparkline,HourHistogram,DedupBadge}.tsx` — SVG/markup primitives.
- `use-usage-snapshot.ts` — React Query hook.
- `overview-tab.tsx`, `costs-tab.tsx` — tab bodies.
- `usage-view.tsx` — WrapView + Titlebar + MainPanel (left rail).
- `usage-view.test.tsx` — render test (browser project).

**Renderer — edits**
- `src/renderer/app/view-registry.ts` — register `usage: usageView`.
- `src/renderer/features/sidebar/left-sidebar.tsx` — "Usage" nav button.

---

## Task 1: Shared contract + internal record types

**Files:**
- Create: `src/shared/usage.ts`
- Create: `src/main/core/usage-stats/types.ts`

- [ ] **Step 1: Create the shared IPC contract**

`src/shared/usage.ts`:

```ts
export type UsageProvider = 'claude' | 'codex';

export type TokenBuckets = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ModelUsage = TokenBuckets & {
  model: string;
  provider: UsageProvider;
  family: string | null; // null = unpriced
  priced: boolean;
  tokens: number; // input + output (excludes cache), for headline figures
  cost: number;
};

export type ProjectUsage = {
  path: string;
  name: string;
  tokens: number;
  cost: number;
  sessions: number;
};

export type DailyPoint = { date: string; cost: number; tokens: number }; // local YYYY-MM-DD

export type RecentSession = {
  id: string;
  provider: UsageProvider;
  cwd: string | null;
  name: string;
  model: string | null;
  lastTs: string;
  messages: number;
  cost: number;
};

export type UsageWindows = { today: number; week: number; month: number; allTime: number };

export type UsageTotals = {
  sessions: number;
  messages: number;
  tokens: number; // input + output (excludes cache)
  tokensWithCache: number;
  cost: number;
};

export type UsageSnapshot = {
  generatedAt: string;
  pricingUpdated: string;
  totals: UsageTotals;
  windows: UsageWindows;
  byModel: ModelUsage[];
  byProject: ProjectUsage[];
  daily: DailyPoint[];
  byHour: number[]; // length 24
  recentSessions: RecentSession[];
  unpricedModels: string[];
};

export const EMPTY_USAGE_SNAPSHOT: UsageSnapshot = {
  generatedAt: '',
  pricingUpdated: '',
  totals: { sessions: 0, messages: 0, tokens: 0, tokensWithCache: 0, cost: 0 },
  windows: { today: 0, week: 0, month: 0, allTime: 0 },
  byModel: [],
  byProject: [],
  daily: [],
  byHour: Array.from({ length: 24 }, () => 0),
  recentSessions: [],
  unpricedModels: [],
};
```

- [ ] **Step 2: Create the internal record types**

`src/main/core/usage-stats/types.ts`:

```ts
import type { UsageProvider } from '@shared/usage';

/** One parsed event. `isMessage` records count toward "messages"; token fields sum into usage. */
export type UsageRecord = {
  id: string; // dedup key: Claude message.id / user uuid; Codex synthetic per-line
  isMessage: boolean;
  provider: UsageProvider;
  ts: string; // ISO; bucketed to LOCAL day/hour at aggregate time
  model: string | null;
  cwd: string | null;
  sessionId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ScannedFile = {
  path: string;
  mtimeMs: number;
  size: number;
  provider: UsageProvider;
};
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm run typecheck`
Expected: PASS (no usages yet; types compile).

```bash
git add src/shared/usage.ts src/main/core/usage-stats/types.ts
git commit -m "feat(usage-stats): add shared UsageSnapshot contract and internal record types"
```

---

## Task 2: Pricing (pure, TDD)

**Files:**
- Create: `src/main/core/usage-stats/pricing.ts`
- Test: `src/main/core/usage-stats/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/core/usage-stats/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { costOf, isPriced, normalizeModelFamily } from './pricing';

describe('normalizeModelFamily', () => {
  it('maps known families by substring, including future versions', () => {
    expect(normalizeModelFamily('claude-opus-4-8')).toBe('opus');
    expect(normalizeModelFamily('claude-opus-4-9-future')).toBe('opus'); // never silently $0
    expect(normalizeModelFamily('claude-sonnet-4-6')).toBe('sonnet');
    expect(normalizeModelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(normalizeModelFamily('gpt-5.4-mini')).toBe('gpt5mini');
    expect(normalizeModelFamily('gpt-5.5')).toBe('gpt5');
    expect(normalizeModelFamily('codex-auto-review')).toBe('gpt5');
  });

  it('returns null for unknown models', () => {
    expect(normalizeModelFamily('llama-3')).toBeNull();
    expect(isPriced('llama-3')).toBe(false);
    expect(isPriced('claude-opus-4-8')).toBe(true);
  });
});

describe('costOf', () => {
  it('prices each bucket per million tokens', () => {
    // opus: input 5, output 25, cacheRead 0.5, cacheWrite 6.25 (per 1M)
    const cost = costOf(
      { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
      'claude-opus-4-8'
    );
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
  });

  it('returns 0 for unpriced models', () => {
    expect(costOf({ input: 9e9, output: 9e9, cacheRead: 0, cacheWrite: 0 }, 'llama-3')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project node src/main/core/usage-stats/pricing.test.ts`
Expected: FAIL ("Failed to resolve import './pricing'").

- [ ] **Step 3: Write the implementation**

`src/main/core/usage-stats/pricing.ts`:

```ts
import type { TokenBuckets } from '@shared/usage';

/** Date the bundled rate table was last reviewed. Surfaced in the UI. */
export const PRICING_UPDATED = '2026-05-31';

type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Per MILLION tokens. Anthropic rates from the Readout pricing reference;
// OpenAI gpt-5 rates are approximate published API rates (editable here).
const FAMILY_RATES: Record<string, Rates> = {
  opus: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  sonnet: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  gpt5mini: { input: 0.25, output: 2.0, cacheRead: 0.025, cacheWrite: 0 },
  gpt5: { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 },
};

/** Substring match → family, so new model versions still price instead of costing $0. */
export function normalizeModelFamily(model: string): string | null {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('gpt-5') && m.includes('mini')) return 'gpt5mini';
  if (m.includes('gpt-5') || m.includes('codex')) return 'gpt5';
  return null;
}

export function isPriced(model: string): boolean {
  return normalizeModelFamily(model) !== null;
}

export function costOf(b: TokenBuckets, model: string): number {
  const family = normalizeModelFamily(model);
  if (!family) return 0;
  const r = FAMILY_RATES[family];
  return (
    (b.input / 1e6) * r.input +
    (b.output / 1e6) * r.output +
    (b.cacheRead / 1e6) * r.cacheRead +
    (b.cacheWrite / 1e6) * r.cacheWrite
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project node src/main/core/usage-stats/pricing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/usage-stats/pricing.ts src/main/core/usage-stats/pricing.test.ts
git commit -m "feat(usage-stats): add model pricing with substring family fallback"
```

---

## Task 3: Claude transcript parser (pure, TDD)

**Files:**
- Create: `src/main/core/usage-stats/parse-claude.ts`
- Test: `src/main/core/usage-stats/parse-claude.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/core/usage-stats/parse-claude.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript } from './parse-claude';

const asst = (id: string, usage: object, extra: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-05-30T17:12:46.766Z',
    sessionId: 'sess-1',
    cwd: '/Users/x/dev/garlic',
    requestId: 'req-' + id,
    message: { id, model: 'claude-opus-4-8', usage },
    ...extra,
  });

describe('parseClaudeTranscript', () => {
  it('extracts assistant usage records with token buckets', () => {
    const text = asst('msg_1', {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 7,
    });
    const records = parseClaudeTranscript(text);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'msg_1',
      isMessage: true,
      provider: 'claude',
      model: 'claude-opus-4-8',
      cwd: '/Users/x/dev/garlic',
      sessionId: 'sess-1',
      input: 100,
      output: 20,
      cacheRead: 5,
      cacheWrite: 7,
    });
  });

  it('extracts user messages as zero-token records keyed by uuid', () => {
    const text = JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', sessionId: 's' });
    const [r] = parseClaudeTranscript(text);
    expect(r).toMatchObject({ id: 'u1', isMessage: true, input: 0, output: 0 });
  });

  it('skips malformed lines and blank lines without throwing', () => {
    const text = ['not json', '', asst('msg_2', { input_tokens: 1, output_tokens: 1 })].join('\n');
    const records = parseClaudeTranscript(text);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('msg_2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project node src/main/core/usage-stats/parse-claude.test.ts`
Expected: FAIL ("Failed to resolve import './parse-claude'").

- [ ] **Step 3: Write the implementation**

`src/main/core/usage-stats/parse-claude.ts`:

```ts
import type { UsageRecord } from './types';

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type ClaudeLine = {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  uuid?: string;
  requestId?: string;
  message?: { id?: string; model?: string; usage?: ClaudeUsage };
};

export function parseClaudeTranscript(text: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let o: ClaudeLine;
    try {
      o = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }

    if (o.type === 'assistant' && o.message?.usage) {
      const id = o.message.id ?? o.requestId;
      if (!id) continue;
      const u = o.message.usage;
      out.push({
        id,
        isMessage: true,
        provider: 'claude',
        ts: o.timestamp ?? '',
        model: o.message.model ?? null,
        cwd: o.cwd ?? null,
        sessionId: o.sessionId ?? '',
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      });
    } else if (o.type === 'user' && o.uuid) {
      out.push({
        id: o.uuid,
        isMessage: true,
        provider: 'claude',
        ts: o.timestamp ?? '',
        model: null,
        cwd: o.cwd ?? null,
        sessionId: o.sessionId ?? '',
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project node src/main/core/usage-stats/parse-claude.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/usage-stats/parse-claude.ts src/main/core/usage-stats/parse-claude.test.ts
git commit -m "feat(usage-stats): add Claude transcript parser"
```

---

## Task 4: Codex rollout parser (pure, TDD)

**Files:**
- Create: `src/main/core/usage-stats/parse-codex.ts`
- Test: `src/main/core/usage-stats/parse-codex.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/core/usage-stats/parse-codex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCodexRollout } from './parse-codex';

const meta = JSON.stringify({
  type: 'session_meta',
  timestamp: '2026-05-30T20:26:13Z',
  payload: { id: 'cdx-1', cwd: '/Users/x/dev/f1-game' },
});
const turn = (model: string) =>
  JSON.stringify({ type: 'turn_context', timestamp: 't', payload: { model } });
const tokenCount = (input: number, cached: number, output: number) =>
  JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-05-30T20:26:15Z',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } },
  });

describe('parseCodexRollout', () => {
  it('attributes cumulative-delta usage to the active model, subtracting cached from input', () => {
    // cumulative totals grow: first 100/40-cached/10-out, then 250/90/30
    const text = [meta, turn('gpt-5.4'), tokenCount(100, 40, 10), tokenCount(250, 90, 30)].join('\n');
    const records = parseCodexRollout(text, '/sessions/r.jsonl').filter((r) => !r.isMessage);
    expect(records).toHaveLength(2);
    // first delta: input 100, cached 40 → input=60, cacheRead=40, output=10
    expect(records[0]).toMatchObject({ model: 'gpt-5.4', input: 60, cacheRead: 40, output: 10, provider: 'codex', cwd: '/Users/x/dev/f1-game' });
    // second delta: inputΔ=150, cachedΔ=50 → input=100, cacheRead=50, output=20
    expect(records[1]).toMatchObject({ input: 100, cacheRead: 50, output: 20 });
  });

  it('counts user/agent messages and gives every record a unique id', () => {
    const userMsg = JSON.stringify({ type: 'event_msg', timestamp: 't', payload: { type: 'user_message' } });
    const agentMsg = JSON.stringify({ type: 'event_msg', timestamp: 't', payload: { type: 'agent_message' } });
    const text = [meta, turn('gpt-5.5'), userMsg, agentMsg].join('\n');
    const records = parseCodexRollout(text, '/sessions/r.jsonl');
    const ids = new Set(records.map((r) => r.id));
    expect(ids.size).toBe(records.length);
    expect(records.filter((r) => r.isMessage)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project node src/main/core/usage-stats/parse-codex.test.ts`
Expected: FAIL ("Failed to resolve import './parse-codex'").

- [ ] **Step 3: Write the implementation**

`src/main/core/usage-stats/parse-codex.ts`:

```ts
import type { UsageRecord } from './types';

type CodexTotals = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
};

type CodexLine = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    id?: string;
    cwd?: string;
    info?: { total_token_usage?: CodexTotals };
  };
};

export function parseCodexRollout(text: string, filePath: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  let model: string | null = null;
  let cwd: string | null = null;
  let sessionId = filePath;
  let prevInput = 0;
  let prevCached = 0;
  let prevOutput = 0;
  let idx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let o: CodexLine;
    try {
      o = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }
    const p = o.payload;

    if (o.type === 'session_meta' && p) {
      cwd = p.cwd ?? cwd;
      sessionId = p.id ?? sessionId;
    } else if (o.type === 'turn_context' && p?.model) {
      model = p.model;
    } else if (o.type === 'event_msg' && p) {
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        const t = p.info.total_token_usage;
        const inputD = Math.max((t.input_tokens ?? 0) - prevInput, 0);
        const cachedD = Math.max((t.cached_input_tokens ?? 0) - prevCached, 0);
        const outputD = Math.max((t.output_tokens ?? 0) - prevOutput, 0);
        prevInput = t.input_tokens ?? prevInput;
        prevCached = t.cached_input_tokens ?? prevCached;
        prevOutput = t.output_tokens ?? prevOutput;
        if (inputD || cachedD || outputD) {
          out.push({
            id: `codex:${filePath}:${idx++}`,
            isMessage: false,
            provider: 'codex',
            ts: o.timestamp ?? '',
            model,
            cwd,
            sessionId,
            input: Math.max(inputD - cachedD, 0),
            output: outputD,
            cacheRead: cachedD,
            cacheWrite: 0,
          });
        }
      } else if (p.type === 'user_message' || p.type === 'agent_message') {
        out.push({
          id: `codex:${filePath}:m${idx++}`,
          isMessage: true,
          provider: 'codex',
          ts: o.timestamp ?? '',
          model,
          cwd,
          sessionId,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project node src/main/core/usage-stats/parse-codex.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/usage-stats/parse-codex.ts src/main/core/usage-stats/parse-codex.test.ts
git commit -m "feat(usage-stats): add Codex rollout parser with cumulative-delta attribution"
```

---

## Task 5: Aggregation (pure, TDD) — the dedup invariant

**Files:**
- Create: `src/main/core/usage-stats/aggregate.ts`
- Test: `src/main/core/usage-stats/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/core/usage-stats/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import type { UsageRecord } from './types';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: 'x',
  isMessage: false,
  provider: 'claude',
  ts: '2026-05-30T12:00:00Z',
  model: 'claude-opus-4-8',
  cwd: '/Users/x/dev/garlic',
  sessionId: 's1',
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

describe('aggregate', () => {
  it('deduplicates records by id so a copied message counts once', () => {
    const r = rec({ id: 'msg_1', isMessage: true, input: 100, output: 50 });
    const snap = aggregate([r, { ...r }, { ...r }], new Date('2026-05-30T18:00:00Z'));
    expect(snap.totals.tokens).toBe(150); // not 450
    expect(snap.totals.messages).toBe(1);
    const opus = snap.byModel.find((m) => m.model === 'claude-opus-4-8');
    expect(opus?.input).toBe(100);
  });

  it('buckets cost by model and flags unpriced models', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1_000_000, model: 'claude-opus-4-8' }),
        rec({ id: 'b', input: 1_000_000, model: 'mystery-model' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.totals.cost).toBeCloseTo(5, 6); // only opus priced (input $5/1M)
    expect(snap.unpricedModels).toContain('mystery-model');
  });

  it('groups projects by cwd basename, sorted by cost', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1_000_000, cwd: '/Users/x/dev/garlic' }),
        rec({ id: 'b', input: 100, cwd: '/Users/x/dev/f1-game' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.byProject[0].name).toBe('garlic');
    expect(snap.byProject.map((p) => p.name)).toContain('f1-game');
  });

  it('produces a 24-length byHour array', () => {
    const snap = aggregate([rec({ id: 'a', input: 10 })], new Date('2026-05-30T18:00:00Z'));
    expect(snap.byHour).toHaveLength(24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project node src/main/core/usage-stats/aggregate.test.ts`
Expected: FAIL ("Failed to resolve import './aggregate'").

- [ ] **Step 3: Write the implementation**

`src/main/core/usage-stats/aggregate.ts`:

```ts
import type {
  DailyPoint,
  ModelUsage,
  ProjectUsage,
  RecentSession,
  UsageSnapshot,
} from '@shared/usage';
import { costOf, isPriced, normalizeModelFamily, PRICING_UPDATED } from './pricing';
import type { UsageRecord } from './types';

const TOP_PROJECTS = 8;
const RECENT_SESSIONS = 8;

function localParts(ts: string): { date: string; hour: number; time: number } | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { date: `${y}-${m}-${day}`, hour: d.getHours(), time: d.getTime() };
}

function basename(p: string | null): string {
  if (!p) return 'unknown';
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
}

function emptyBuckets() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function aggregate(allRecords: UsageRecord[], now: Date): UsageSnapshot {
  // 1. Global dedup, first-wins.
  const byId = new Map<string, UsageRecord>();
  for (const r of allRecords) if (!byId.has(r.id)) byId.set(r.id, r);
  const records = [...byId.values()];

  // 2. Window boundaries (calendar, local time).
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfDay - now.getDay() * 86_400_000; // Sunday start
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const models = new Map<string, ModelUsage>();
  const projects = new Map<string, ProjectUsage>();
  const daily = new Map<string, DailyPoint>();
  const sessions = new Map<string, RecentSession>();
  const byHour = Array.from({ length: 24 }, () => 0);
  const unpriced = new Set<string>();

  const totals = { sessions: 0, messages: 0, tokens: 0, tokensWithCache: 0, cost: 0 };
  const windows = { today: 0, week: 0, month: 0, allTime: 0 };
  const sessionIds = new Set<string>();

  for (const r of records) {
    const buckets = { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite };
    const cost = r.model ? costOf(buckets, r.model) : 0;
    const tokens = r.input + r.output;
    const withCache = tokens + r.cacheRead + r.cacheWrite;

    totals.tokens += tokens;
    totals.tokensWithCache += withCache;
    totals.cost += cost;
    if (r.isMessage) totals.messages += 1;
    if (r.sessionId) sessionIds.add(r.sessionId);

    // by model
    if (r.model) {
      if (!isPriced(r.model)) unpriced.add(r.model);
      const key = r.model;
      const mu = models.get(key) ?? {
        ...emptyBuckets(),
        model: r.model,
        provider: r.provider,
        family: normalizeModelFamily(r.model),
        priced: isPriced(r.model),
        tokens: 0,
        cost: 0,
      };
      mu.input += r.input;
      mu.output += r.output;
      mu.cacheRead += r.cacheRead;
      mu.cacheWrite += r.cacheWrite;
      mu.tokens += tokens;
      mu.cost += cost;
      models.set(key, mu);
    }

    // by project
    if (r.cwd) {
      const pu = projects.get(r.cwd) ?? { path: r.cwd, name: basename(r.cwd), tokens: 0, cost: 0, sessions: 0 };
      pu.tokens += tokens;
      pu.cost += cost;
      projects.set(r.cwd, pu);
    }

    const parts = localParts(r.ts);
    if (parts) {
      byHour[parts.hour] += tokens;
      const dp = daily.get(parts.date) ?? { date: parts.date, cost: 0, tokens: 0 };
      dp.cost += cost;
      dp.tokens += tokens;
      daily.set(parts.date, dp);

      windows.allTime += cost;
      if (parts.time >= startOfDay) windows.today += cost;
      if (parts.time >= startOfWeek) windows.week += cost;
      if (parts.time >= startOfMonth) windows.month += cost;
    }

    // recent sessions
    if (r.sessionId) {
      const su = sessions.get(r.sessionId) ?? {
        id: r.sessionId,
        provider: r.provider,
        cwd: r.cwd,
        name: basename(r.cwd),
        model: r.model,
        lastTs: r.ts,
        messages: 0,
        cost: 0,
      };
      if (r.isMessage) su.messages += 1;
      su.cost += cost;
      if (r.model) su.model = r.model;
      if (r.ts > su.lastTs) su.lastTs = r.ts;
      sessions.set(r.sessionId, su);
    }
  }

  // project session counts
  const sessionCwd = new Map<string, string>();
  for (const r of records) if (r.sessionId && r.cwd) sessionCwd.set(r.sessionId, r.cwd);
  for (const cwd of sessionCwd.values()) {
    const pu = projects.get(cwd);
    if (pu) pu.sessions += 1;
  }

  totals.sessions = sessionIds.size;

  const byProjectAll = [...projects.values()].sort((a, b) => b.cost - a.cost);
  const byProject = byProjectAll.slice(0, TOP_PROJECTS);
  const rest = byProjectAll.slice(TOP_PROJECTS);
  if (rest.length) {
    byProject.push({
      path: '',
      name: 'other',
      tokens: rest.reduce((s, p) => s + p.tokens, 0),
      cost: rest.reduce((s, p) => s + p.cost, 0),
      sessions: rest.reduce((s, p) => s + p.sessions, 0),
    });
  }

  return {
    generatedAt: now.toISOString(),
    pricingUpdated: PRICING_UPDATED,
    totals,
    windows,
    byModel: [...models.values()].sort((a, b) => b.cost - a.cost),
    byProject,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byHour,
    recentSessions: [...sessions.values()]
      .sort((a, b) => b.lastTs.localeCompare(a.lastTs))
      .slice(0, RECENT_SESSIONS),
    unpricedModels: [...unpriced],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project node src/main/core/usage-stats/aggregate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/usage-stats/aggregate.ts src/main/core/usage-stats/aggregate.test.ts
git commit -m "feat(usage-stats): aggregate records into a deduplicated usage snapshot"
```

---

## Task 6: Filesystem scanner (TDD with temp dirs)

**Files:**
- Create: `src/main/core/usage-stats/scanner.ts`
- Test: `src/main/core/usage-stats/scanner.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/core/usage-stats/scanner.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanDir } from './scanner';

describe('scanDir', () => {
  const root = mkdtempSync(join(tmpdir(), 'usage-scan-'));
  afterAll(() => {
    // best-effort; tmp is auto-cleaned by the OS
  });

  it('recursively finds .jsonl files with mtime and size, tagged by provider', () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'top.jsonl'), 'x');
    writeFileSync(join(root, 'a', 'b', 'deep.jsonl'), 'xy');
    writeFileSync(join(root, 'a', 'ignore.txt'), 'no');

    const files = scanDir(root, 'claude');
    const names = files.map((f) => f.path).sort();
    expect(names.some((p) => p.endsWith('top.jsonl'))).toBe(true);
    expect(names.some((p) => p.endsWith('deep.jsonl'))).toBe(true);
    expect(names.some((p) => p.endsWith('.txt'))).toBe(false);
    const deep = files.find((f) => f.path.endsWith('deep.jsonl'))!;
    expect(deep.provider).toBe('claude');
    expect(deep.size).toBe(2);
    expect(deep.mtimeMs).toBeGreaterThan(0);
  });

  it('returns [] for a missing directory without throwing', () => {
    expect(scanDir(join(root, 'does-not-exist'), 'codex')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project node src/main/core/usage-stats/scanner.test.ts`
Expected: FAIL ("Failed to resolve import './scanner'").

- [ ] **Step 3: Write the implementation**

`src/main/core/usage-stats/scanner.ts`:

```ts
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageProvider } from '@shared/usage';
import type { ScannedFile } from './types';

/** Recursively collect *.jsonl under `dir`. Missing dirs yield []. */
export function scanDir(dir: string, provider: UsageProvider): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (current: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return; // missing/unreadable directory
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const st = statSync(full);
          out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size, provider });
        } catch {
          // file vanished between readdir and stat — skip
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** Default source directories for the two supported providers. */
export function defaultUsageSources(home = homedir()): Array<{ dir: string; provider: UsageProvider }> {
  return [
    { dir: join(home, '.claude', 'projects'), provider: 'claude' },
    { dir: join(home, '.codex', 'sessions'), provider: 'codex' },
    { dir: join(home, '.codex', 'archived_sessions'), provider: 'codex' },
  ];
}

export function scanAll(home = homedir()): ScannedFile[] {
  return defaultUsageSources(home).flatMap((s) => scanDir(s.dir, s.provider));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project node src/main/core/usage-stats/scanner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/usage-stats/scanner.ts src/main/core/usage-stats/scanner.test.ts
git commit -m "feat(usage-stats): add recursive transcript scanner"
```

---

## Task 7: Incremental cache (TDD)

**Files:**
- Create: `src/main/core/usage-stats/cache.ts`
- Test: `src/main/core/usage-stats/cache.test.ts`

The cache holds parsed records per file keyed by path, validated by `mtimeMs`+`size`. It is pure w.r.t. its inputs: callers pass the parse function and the current scan, so it is testable without real `~/.claude`.

- [ ] **Step 1: Write the failing test**

`src/main/core/usage-stats/cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { reconcileCache, CACHE_VERSION, type UsageIndex } from './cache';
import type { ScannedFile, UsageRecord } from './types';

const file = (path: string, mtimeMs: number, size: number): ScannedFile => ({
  path,
  mtimeMs,
  size,
  provider: 'claude',
});
const recordsFor = (path: string): UsageRecord[] => [
  { id: path, isMessage: true, provider: 'claude', ts: 't', model: 'claude-opus-4-8', cwd: '/x', sessionId: 's', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
];

describe('reconcileCache', () => {
  it('parses new files and reuses unchanged ones (by mtime+size)', () => {
    const parse = vi.fn((_text: string, f: ScannedFile) => recordsFor(f.path));
    const readText = (_f: ScannedFile) => 'irrelevant';
    const empty: UsageIndex = { version: CACHE_VERSION, files: {} };

    const scan = [file('/a.jsonl', 1, 10)];
    const first = reconcileCache(empty, scan, readText, parse);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(first.records).toHaveLength(1);

    // second pass, same file unchanged → no re-parse
    parse.mockClear();
    const second = reconcileCache(first.index, scan, readText, parse);
    expect(parse).toHaveBeenCalledTimes(0);
    expect(second.records).toHaveLength(1);
  });

  it('re-parses a changed file and drops deleted files', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const readText = () => 'x';
    let { index } = reconcileCache({ version: CACHE_VERSION, files: {} }, [file('/a.jsonl', 1, 10)], readText, parse);

    parse.mockClear();
    const changed = reconcileCache(index, [file('/a.jsonl', 2, 99)], readText, parse); // mtime+size changed
    expect(parse).toHaveBeenCalledTimes(1);

    const afterDelete = reconcileCache(changed.index, [], readText, parse);
    expect(Object.keys(afterDelete.index.files)).toHaveLength(0);
    expect(afterDelete.records).toHaveLength(0);
  });

  it('discards the whole index on version mismatch', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const stale: UsageIndex = { version: CACHE_VERSION - 1, files: { '/a.jsonl': { mtimeMs: 1, size: 10, records: recordsFor('/a.jsonl') } } };
    reconcileCache(stale, [file('/a.jsonl', 1, 10)], () => 'x', parse);
    expect(parse).toHaveBeenCalledTimes(1); // not reused despite matching mtime+size
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project node src/main/core/usage-stats/cache.test.ts`
Expected: FAIL ("Failed to resolve import './cache'").

- [ ] **Step 3: Write the implementation**

`src/main/core/usage-stats/cache.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { ScannedFile, UsageRecord } from './types';

export const CACHE_VERSION = 1;

export type CachedFile = { mtimeMs: number; size: number; records: UsageRecord[] };
export type UsageIndex = { version: number; files: Record<string, CachedFile> };

export type ReadText = (file: ScannedFile) => string;
export type ParseFn = (text: string, file: ScannedFile) => UsageRecord[];

/** Returns the next index plus the flattened records across all current files. */
export function reconcileCache(
  prev: UsageIndex,
  scan: ScannedFile[],
  readText: ReadText,
  parse: ParseFn
): { index: UsageIndex; records: UsageRecord[] } {
  const usable = prev.version === CACHE_VERSION ? prev.files : {};
  const nextFiles: Record<string, CachedFile> = {};
  const records: UsageRecord[] = [];

  for (const file of scan) {
    const cached = usable[file.path];
    if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
      nextFiles[file.path] = cached;
      records.push(...cached.records);
      continue;
    }
    let parsed: UsageRecord[] = [];
    try {
      parsed = parse(readText(file), file);
    } catch {
      parsed = []; // unreadable file — skip its records, keep going
    }
    nextFiles[file.path] = { mtimeMs: file.mtimeMs, size: file.size, records: parsed };
    records.push(...parsed);
  }

  return { index: { version: CACHE_VERSION, files: nextFiles }, records };
}

export function loadIndex(path: string): UsageIndex {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as UsageIndex;
    if (parsed.version === CACHE_VERSION && parsed.files) return parsed;
  } catch {
    // missing or corrupt — start fresh
  }
  return { version: CACHE_VERSION, files: {} };
}

export function saveIndex(path: string, index: UsageIndex): void {
  try {
    writeFileSync(path, JSON.stringify(index));
  } catch {
    // non-fatal: cache is an optimization, not a source of truth
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project node src/main/core/usage-stats/cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/usage-stats/cache.ts src/main/core/usage-stats/cache.test.ts
git commit -m "feat(usage-stats): add incremental file-index cache"
```

---

## Task 8: Service, operations, controller, and wiring

**Files:**
- Create: `src/main/core/usage-stats/usage-stats-service.ts`
- Create: `src/main/core/usage-stats/operations.ts`
- Create: `src/main/core/usage-stats/controller.ts`
- Modify: `src/main/rpc.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the service**

`src/main/core/usage-stats/usage-stats-service.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from '@shared/usage';
import { aggregate } from './aggregate';
import { loadIndex, reconcileCache, saveIndex, type UsageIndex } from './cache';
import { parseClaudeTranscript } from './parse-claude';
import { parseCodexRollout } from './parse-codex';
import { scanAll } from './scanner';
import type { ScannedFile } from './types';

class UsageStatsService {
  private snapshot: UsageSnapshot = EMPTY_USAGE_SNAPSHOT;
  private indexPath = '';
  private computing: Promise<UsageSnapshot> | null = null;

  /** Fire-and-forget background warm on app start. */
  initialize(): void {
    void this.refresh().catch(() => {
      // first scan failed (e.g. no transcript dirs) — keep empty snapshot
    });
  }

  async getSnapshot(): Promise<UsageSnapshot> {
    if (this.snapshot.generatedAt === '') return this.refresh();
    return this.snapshot;
  }

  async refresh(): Promise<UsageSnapshot> {
    if (this.computing) return this.computing;
    this.computing = this.compute().finally(() => {
      this.computing = null;
    });
    return this.computing;
  }

  private async compute(): Promise<UsageSnapshot> {
    const indexPath = this.getIndexPath();
    const prev: UsageIndex = loadIndex(indexPath);
    const scan = scanAll();
    const { index, records } = reconcileCache(prev, scan, readScannedText, parseScannedFile);
    saveIndex(indexPath, index);
    this.snapshot = aggregate(records, new Date());
    return this.snapshot;
  }

  private getIndexPath(): string {
    if (!this.indexPath) this.indexPath = join(app.getPath('userData'), 'usage-index.json');
    return this.indexPath;
  }
}

function readScannedText(file: ScannedFile): string {
  return readFileSync(file.path, 'utf8');
}

function parseScannedFile(text: string, file: ScannedFile) {
  return file.provider === 'claude'
    ? parseClaudeTranscript(text)
    : parseCodexRollout(text, file.path);
}

export const usageStatsService = new UsageStatsService();
```

- [ ] **Step 2: Write the operations**

`src/main/core/usage-stats/operations.ts`:

```ts
import type { UsageSnapshot } from '@shared/usage';
import { usageStatsService } from './usage-stats-service';

export function getUsageSnapshot(): Promise<UsageSnapshot> {
  return usageStatsService.getSnapshot();
}

export function refreshUsage(): Promise<UsageSnapshot> {
  return usageStatsService.refresh();
}
```

- [ ] **Step 3: Write the controller**

`src/main/core/usage-stats/controller.ts`:

```ts
import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { getUsageSnapshot, refreshUsage } from './operations';

export const usageStatsController = createRPCController({
  getSnapshot: async () => ok(await getUsageSnapshot()),
  refresh: async () => ok(await refreshUsage()),
});
```

- [ ] **Step 4: Register the controller in the router**

Modify `src/main/rpc.ts`. Add the import (alphabetical, near the other `core/*` imports):

```ts
import { usageStatsController } from './core/usage-stats/controller';
```

Add to the `createRPCRouter({ ... })` object (place after `resourceMonitor:`):

```ts
  usageStats: usageStatsController,
```

- [ ] **Step 5: Warm the service on startup**

Modify `src/main/index.ts`. Add the import near other service imports:

```ts
import { usageStatsService } from './core/usage-stats/usage-stats-service';
```

Add the init call alongside the other fire-and-forget initializers (next to `searchService.initialize();` / `workspaceFileIndexService.initialize();`, ~line 94-95):

```ts
    usageStatsService.initialize();
```

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS. The renderer now has `rpc.usageStats.getSnapshot()` and `rpc.usageStats.refresh()` available via inferred `RpcRouter`.

- [ ] **Step 7: Commit**

```bash
git add src/main/core/usage-stats/usage-stats-service.ts src/main/core/usage-stats/operations.ts src/main/core/usage-stats/controller.ts src/main/rpc.ts src/main/index.ts
git commit -m "feat(usage-stats): wire service, operations, controller, and RPC registration"
```

---

## Task 9: Renderer formatters + SVG primitives

**Files:**
- Create: `src/renderer/features/usage/format.ts`
- Test: `src/renderer/features/usage/format.test.ts`
- Create: `src/renderer/features/usage/components/StatCard.tsx`
- Create: `src/renderer/features/usage/components/BarRow.tsx`
- Create: `src/renderer/features/usage/components/Sparkline.tsx`
- Create: `src/renderer/features/usage/components/HourHistogram.tsx`
- Create: `src/renderer/features/usage/components/DedupBadge.tsx`

- [ ] **Step 1: Write the failing formatter test**

`src/renderer/features/usage/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fmtTokens, fmtUsd } from './format';

describe('fmtTokens', () => {
  it('uses compact suffixes', () => {
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(1_500)).toBe('1.5K');
    expect(fmtTokens(128_800_000)).toBe('128.8M');
    expect(fmtTokens(2_400_000_000)).toBe('2.4B');
  });
});

describe('fmtUsd', () => {
  it('formats whole-dollar currency with separators', () => {
    expect(fmtUsd(3078)).toBe('$3,078');
    expect(fmtUsd(0)).toBe('$0');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project node src/renderer/features/usage/format.test.ts`
Expected: FAIL ("Failed to resolve import './format'").

- [ ] **Step 3: Implement the formatters**

`src/renderer/features/usage/format.ts`:

```ts
export function fmtTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Two-decimal dollars for small figures (e.g. "Today $10.70"). */
export function fmtUsdPrecise(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run --project node src/renderer/features/usage/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the SVG/markup primitives**

`src/renderer/features/usage/components/StatCard.tsx`:

```tsx
export function StatCard({ value, label, dot }: { value: string; label: string; dot?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3">
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-foreground-muted">
        {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
    </div>
  );
}
```

`src/renderer/features/usage/components/BarRow.tsx`:

```tsx
export function BarRow({ label, value, max, color = 'var(--accent)' }: { label: string; value: string; max: number; color?: string }) {
  return null as never; // replaced below — placeholder removed in implementation
}
```

Replace the placeholder body above with this real implementation (do not keep the stub):

```tsx
export function BarRow({
  label,
  amount,
  ratio,
  color = 'var(--accent)',
}: {
  label: string;
  amount: string;
  ratio: number; // 0..1
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-20 shrink-0 truncate text-xs text-foreground-muted">{label}</div>
      <div className="h-2.5 flex-1 overflow-hidden rounded bg-background-2">
        <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, background: color }} />
      </div>
      <div className="w-14 shrink-0 text-right text-xs tabular-nums text-foreground-muted">{amount}</div>
    </div>
  );
}
```

`src/renderer/features/usage/components/Sparkline.tsx`:

```tsx
export function Sparkline({ values, height = 48, color = 'var(--accent)', label }: { values: number[]; height?: number; color?: string; label?: string }) {
  const max = Math.max(1, ...values);
  const w = 100;
  const n = Math.max(values.length, 1);
  const bw = w / n;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label ?? 'activity over time'}>
      {values.map((v, i) => {
        const h = (v / max) * height;
        return <rect key={i} x={i * bw + bw * 0.15} y={height - h} width={bw * 0.7} height={h} rx={0.5} fill={color} opacity={0.85} />;
      })}
    </svg>
  );
}
```

`src/renderer/features/usage/components/HourHistogram.tsx`:

```tsx
export function HourHistogram({ byHour, height = 44 }: { byHour: number[]; height?: number }) {
  const max = Math.max(1, ...byHour);
  const colorFor = (h: number) =>
    h < 6 ? 'var(--foreground-muted)' : h < 12 ? '#4caf6e' : h < 18 ? 'var(--accent)' : '#d9a443';
  return (
    <svg viewBox={`0 0 24 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="usage by hour of day">
      {byHour.map((v, h) => {
        const bh = (v / max) * height;
        return <rect key={h} x={h + 0.15} y={height - bh} width={0.7} height={bh} rx={0.2} fill={colorFor(h)} />;
      })}
    </svg>
  );
}
```

`src/renderer/features/usage/components/DedupBadge.tsx`:

```tsx
export function DedupBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-foreground-muted"
      title="Counts each API response once. Resumed/forked session copies are not double-counted, so totals are lower than tools that count raw transcript lines."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-foreground-muted" />
      deduplicated
    </span>
  );
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm run typecheck`
Expected: PASS.

```bash
git add src/renderer/features/usage/format.ts src/renderer/features/usage/format.test.ts src/renderer/features/usage/components
git commit -m "feat(usage-stats): add renderer formatters and SVG stat primitives"
```

---

## Task 10: React Query data hook

**Files:**
- Create: `src/renderer/features/usage/use-usage-snapshot.ts`

- [ ] **Step 1: Implement the hook**

`src/renderer/features/usage/use-usage-snapshot.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from '@shared/usage';
import { rpc } from '@renderer/lib/ipc';

const KEY = ['usage', 'snapshot'] as const;

async function fetchSnapshot(): Promise<UsageSnapshot> {
  const res = await rpc.usageStats.getSnapshot();
  if (!res.success) throw new Error(typeof res.error === 'string' ? res.error : 'Failed to load usage');
  return res.data;
}

export function useUsageSnapshot() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: fetchSnapshot, staleTime: 60_000 });

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await rpc.usageStats.refresh();
      if (!res.success) throw new Error(typeof res.error === 'string' ? res.error : 'Failed to refresh usage');
      return res.data;
    },
    onSuccess: (snapshot) => queryClient.setQueryData(KEY, snapshot),
  });

  return {
    snapshot: query.data ?? EMPTY_USAGE_SNAPSHOT,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    refresh: () => refresh.mutate(),
    isRefreshing: refresh.isPending,
  };
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm run typecheck`
Expected: PASS.

```bash
git add src/renderer/features/usage/use-usage-snapshot.ts
git commit -m "feat(usage-stats): add useUsageSnapshot React Query hook"
```

---

## Task 11: Overview and Costs tab bodies

**Files:**
- Create: `src/renderer/features/usage/overview-tab.tsx`
- Create: `src/renderer/features/usage/costs-tab.tsx`

- [ ] **Step 1: Implement the Overview tab**

`src/renderer/features/usage/overview-tab.tsx`:

```tsx
import type { UsageSnapshot } from '@shared/usage';
import { BarRow } from './components/BarRow';
import { DedupBadge } from './components/DedupBadge';
import { HourHistogram } from './components/HourHistogram';
import { Sparkline } from './components/Sparkline';
import { StatCard } from './components/StatCard';
import { fmtTokens, fmtUsd } from './format';

export function OverviewTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { totals, daily, byHour, byModel, byProject, recentSessions } = snapshot;
  const modelMax = Math.max(1, ...byModel.map((m) => m.cost));
  const projMax = Math.max(1, ...byProject.map((p) => p.cost));

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="flex items-center justify-between">
        <div className="text-sm text-foreground-muted">Across Claude Code &amp; Codex</div>
        <DedupBadge />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={String(totals.sessions)} label="Sessions" dot="var(--accent)" />
        <StatCard value={fmtTokens(totals.messages)} label="Messages" dot="#4caf6e" />
        <StatCard value={fmtTokens(totals.tokens)} label="Tokens" dot="#d9a443" />
        <StatCard value={fmtUsd(totals.cost)} label="Est. Cost" dot="#9a7af0" />
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Activity</div>
        <Sparkline values={daily.map((d) => d.tokens)} label="tokens per day" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="mb-2 text-sm font-medium text-foreground">When you work</div>
          <HourHistogram byHour={byHour} />
        </div>
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="mb-2 text-sm font-medium text-foreground">Cost by model</div>
          {byModel.map((m) => (
            <BarRow key={m.model} label={m.model} amount={fmtUsd(m.cost)} ratio={m.cost / modelMax} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Top projects</div>
        {byProject.map((p) => (
          <BarRow key={p.path || p.name} label={p.name} amount={fmtUsd(p.cost)} ratio={p.cost / projMax} />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Recent sessions</div>
        {recentSessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between border-t border-border/50 py-1.5 text-sm first:border-t-0">
            <span className="truncate text-foreground-muted">{s.name}</span>
            <span className="shrink-0 pl-2 text-xs text-foreground-muted">{s.model ?? s.provider}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the Costs tab**

`src/renderer/features/usage/costs-tab.tsx`:

```tsx
import type { UsageSnapshot } from '@shared/usage';
import { BarRow } from './components/BarRow';
import { Sparkline } from './components/Sparkline';
import { StatCard } from './components/StatCard';
import { fmtUsd, fmtUsdPrecise } from './format';

function projectMonthly(monthToDate: number, now: Date): number {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (dayOfMonth === 0) return monthToDate;
  return (monthToDate / dayOfMonth) * daysInMonth;
}

export function CostsTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { windows, byModel, byProject, daily } = snapshot;
  const now = new Date();
  const projected = projectMonthly(windows.month, now);
  const modelMax = Math.max(1, ...byModel.map((m) => m.cost));
  const projMax = Math.max(1, ...byProject.map((p) => p.cost));

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={fmtUsdPrecise(windows.today)} label="Today" dot="var(--accent)" />
        <StatCard value={fmtUsdPrecise(windows.week)} label="This Week" dot="#4caf6e" />
        <StatCard value={fmtUsd(windows.month)} label="This Month" dot="#d9a443" />
        <StatCard value={fmtUsd(windows.allTime)} label="All Time" dot="#9a7af0" />
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Cost by model</div>
        {byModel.map((m) => (
          <BarRow key={m.model} label={m.model} amount={fmtUsd(m.cost)} ratio={m.cost / modelMax} color="#d9a443" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="text-sm font-medium text-foreground">Monthly projection</div>
          <div className="mt-2 flex items-end gap-6">
            <div>
              <div className="text-xl font-semibold tabular-nums text-foreground">{fmtUsd(projected)}</div>
              <div className="text-xs text-foreground-muted">Projected</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums text-foreground">{fmtUsd(windows.month)}</div>
              <div className="text-xs text-foreground-muted">So far</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="mb-2 text-sm font-medium text-foreground">Top projects</div>
          {byProject.map((p) => (
            <BarRow key={p.path || p.name} label={p.name} amount={fmtUsd(p.cost)} ratio={p.cost / projMax} color="#d9a443" />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Daily cost</div>
        <Sparkline values={daily.map((d) => d.cost)} color="#d9a443" label="cost per day" />
      </div>
    </div>
  );
}
```

> NOTE (Trends): the design lists a Trends panel (this week vs last week). It is intentionally **omitted from v1 tabs** because the snapshot exposes only the current windows, not prior-period totals. If desired, add `prevWeek`/`prevMonth` to `UsageWindows` and a follow-up task; this is recorded in the spec's "known follow-ups". Do not leave a placeholder panel in the UI.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm run typecheck`
Expected: PASS.

```bash
git add src/renderer/features/usage/overview-tab.tsx src/renderer/features/usage/costs-tab.tsx
git commit -m "feat(usage-stats): add Overview and Costs tab bodies"
```

---

## Task 12: The Usage view + registration + nav

**Files:**
- Create: `src/renderer/features/usage/usage-view.tsx`
- Modify: `src/renderer/app/view-registry.ts`
- Modify: `src/renderer/features/sidebar/left-sidebar.tsx`

- [ ] **Step 1: Implement the view (clone of library-view structure)**

`src/renderer/features/usage/usage-view.tsx`:

```tsx
import { RotateCw } from 'lucide-react';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { CostsTab } from './costs-tab';
import { OverviewTab } from './overview-tab';
import { useUsageSnapshot } from './use-usage-snapshot';

export type UsageTab = 'overview' | 'costs';

const tabs: Array<{ id: UsageTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'costs', label: 'Costs' },
];

const UsageTabContext = createContext<{ tab: UsageTab; onTabChange: (t: UsageTab) => void }>({
  tab: 'overview',
  onTabChange: () => {},
});

export function UsageViewWrapper({ children, tab = 'overview' }: { children: ReactNode; tab?: UsageTab }) {
  const { setParams } = useParams('usage');
  const onTabChange = useCallback((next: UsageTab) => setParams({ tab: next }), [setParams]);
  return <UsageTabContext.Provider value={{ tab, onTabChange }}>{children}</UsageTabContext.Provider>;
}

function useUsageTab() {
  return useContext(UsageTabContext);
}

export function UsageTitlebar() {
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center px-2">
          <span className="text-sm text-foreground-muted">Usage</span>
        </div>
      }
    />
  );
}

export function UsageMainPanel() {
  const { tab, onTabChange } = useUsageTab();
  const { snapshot, isLoading, isError, refresh, isRefreshing, refetch } = useUsageSnapshot();

  const hasData = snapshot.totals.sessions > 0 || snapshot.daily.length > 0;

  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1060px] grid-cols-[13rem_minmax(0,1fr)] gap-8 px-8">
        <div className="py-10">
          <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                  item.id === tab && 'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                )}
              >
                {item.label}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 justify-start gap-2 px-3 text-foreground-muted"
              onClick={() => refresh()}
              disabled={isRefreshing}
            >
              {isRefreshing ? <Spinner className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </nav>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto py-10">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : isError ? (
            <EmptyState title="Couldn't load usage" description="Something went wrong reading your transcripts.">
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </EmptyState>
          ) : !hasData ? (
            <EmptyState title="No usage yet" description="No Claude Code or Codex usage was found on this machine." />
          ) : tab === 'overview' ? (
            <OverviewTab snapshot={snapshot} />
          ) : (
            <CostsTab snapshot={snapshot} />
          )}
        </div>
      </div>
    </div>
  );
}

export const usageView = {
  WrapView: UsageViewWrapper,
  TitlebarSlot: UsageTitlebar,
  MainPanel: UsageMainPanel,
};
```

> Before implementing, confirm the exact export names of `EmptyState` and `Spinner` in `src/renderer/lib/ui/empty-state.tsx` and `src/renderer/lib/ui/spinner.tsx` and the `Button` variants in `src/renderer/lib/ui/button.tsx`; adjust imports/props to match (these primitives exist per the UI directory listing). If `EmptyState` does not accept `children`, render the retry button beside it instead.

- [ ] **Step 2: Register the view**

Modify `src/renderer/app/view-registry.ts`. Add import:

```ts
import { usageView } from '@renderer/features/usage/usage-view';
```

Add to the `views` object (after `mcp: mcpView,`):

```ts
  usage: usageView,
```

- [ ] **Step 3: Add the sidebar nav button**

Modify `src/renderer/features/sidebar/left-sidebar.tsx`.

Update the lucide import to include `Gauge`:

```ts
import { FolderInput, Gauge, Library, MessageSquareShare, Settings } from 'lucide-react';
```

Insert a new `SidebarMenuButton` in the `SidebarFooter`'s `SidebarMenu`, immediately after the Library button and before the Settings button:

```tsx
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'usage')}
              onClick={() => navigate('usage')}
              aria-label="Usage"
              className="w-full justify-start"
            >
              <span className="flex items-center gap-2">
                <Gauge className="h-5 w-5 sm:h-4 sm:w-4" />
                Usage
              </span>
            </SidebarMenuButton>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS. (`useParams('usage')` now type-checks because `usage` is a registered view.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/usage/usage-view.tsx src/renderer/app/view-registry.ts src/renderer/features/sidebar/left-sidebar.tsx
git commit -m "feat(usage-stats): add Usage view, register it, and add sidebar nav"
```

---

## Task 13: Render test, full gate, and manual smoke

**Files:**
- Create: `src/renderer/features/usage/usage-view.test.tsx`

- [ ] **Step 1: Write a render smoke test**

`src/renderer/features/usage/usage-view.test.tsx`:

```tsx
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import type { UsageSnapshot } from '@shared/usage';
import { EMPTY_USAGE_SNAPSHOT } from '@shared/usage';
import { OverviewTab } from './overview-tab';
import { CostsTab } from './costs-tab';

const snapshot: UsageSnapshot = {
  ...EMPTY_USAGE_SNAPSHOT,
  generatedAt: '2026-05-31T00:00:00Z',
  totals: { sessions: 3, messages: 120, tokens: 1_500_000, tokensWithCache: 9_000_000, cost: 42 },
  windows: { today: 1.5, week: 10, month: 30, allTime: 42 },
  byModel: [{ model: 'claude-opus-4-8', provider: 'claude', family: 'opus', priced: true, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, tokens: 2, cost: 40 }],
  byProject: [{ path: '/x/garlic', name: 'garlic', tokens: 2, cost: 40, sessions: 2 }],
  daily: [{ date: '2026-05-30', cost: 40, tokens: 1_000_000 }],
  recentSessions: [{ id: 's1', provider: 'claude', cwd: '/x/garlic', name: 'garlic', model: 'claude-opus-4-8', lastTs: 't', messages: 5, cost: 40 }],
};

describe('usage tabs', () => {
  it('renders Overview with hero figures', async () => {
    const screen = render(<OverviewTab snapshot={snapshot} />);
    await expect.element(screen.getByText('Sessions')).toBeInTheDocument();
    await expect.element(screen.getByText('$42')).toBeInTheDocument();
  });

  it('renders Costs with window cards', async () => {
    const screen = render(<CostsTab snapshot={snapshot} />);
    await expect.element(screen.getByText('This Month')).toBeInTheDocument();
  });
});
```

> Confirm the browser test helper import matches existing renderer tests under `src/renderer/tests/browser/` (e.g. the exact `render`/`expect.element` API). Mirror a neighboring `*.test.tsx` in that folder; adjust imports if the project uses a different helper.

- [ ] **Step 2: Run the render test**

Run: `pnpm vitest run --project browser src/renderer/features/usage/usage-view.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 3: Run the full merge gate**

Run: `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all PASS. Fix any lint/format issues the gate reports (e.g. import order via `oxfmt`).

- [ ] **Step 4: Manual smoke test**

Run: `pnpm run dev`
Verify:
- A "Usage" item appears in the left sidebar between Library and Settings; clicking it opens the view.
- Overview shows non-zero Sessions/Tokens/Cost, an activity sparkline, when-you-work, cost-by-model, top projects, recent sessions, and the "deduplicated" badge.
- Costs tab shows the four window cards, cost-by-model, monthly projection, top projects, daily cost.
- Refresh re-computes without error.
- Cross-check the all-time cost is in the same ballpark as the validation script (`/tmp/emdash-usage-validate.py`) — deduped totals, not Readout's inflated figure.

- [ ] **Step 5: Final commit**

```bash
git add src/renderer/features/usage/usage-view.test.tsx
git commit -m "test(usage-stats): add Usage tab render smoke tests"
```

---

## Self-review notes (addressed)

- **Spec coverage:** Usage + Costs panels, dedup-by-id, on-disk incremental cache, top-projects, SVG charts, emdash-native left-rail view, pricing fallback, providers Claude+Codex — all mapped to Tasks 1–13. **Trends panel** is explicitly deferred (Task 11 note) because the snapshot does not carry prior-period totals; this matches the spec's "known follow-ups" and avoids shipping a placeholder.
- **Type consistency:** `UsageRecord` (with `isMessage`) defined in Task 1 and used identically in Tasks 3–8. `UsageSnapshot`/`ModelUsage`/`ProjectUsage` from `@shared/usage` used consistently. `reconcileCache`/`CACHE_VERSION`/`UsageIndex` names consistent across Tasks 7–8. Controller methods `getSnapshot`/`refresh` match `rpc.usageStats.*` calls in Task 10.
- **No placeholders:** the one stub in Task 9 (`BarRow`) is explicitly replaced in the same step with the real implementation and called out as "do not keep the stub."
- **Verification gaps flagged inline:** exact `EmptyState`/`Spinner`/`Button` prop shapes (Task 12) and the browser-test helper API (Task 13) are marked to confirm against existing code before implementing, since those primitives were catalogued but not read field-by-field.
```
