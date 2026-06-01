# Usage Stats — Design Spec

- **Date:** 2026-05-31
- **Branch:** `stats-4ahru`
- **Status:** Approved design, pre-implementation
- **Scope (v1):** A "Usage" view showing AI agent usage + cost analytics for Claude Code and Codex, derived entirely from local transcript files. Read-only, offline, no new external dependencies.

---

## 1. Goal & context

Add a **Usage** screen to emdash that surfaces token usage, cost, sessions, activity-over-time, model breakdown, and a per-project breakdown for the user's AI coding agents — comparable to the macOS apps *Readout* and *CodexBar*.

The enabling insight: both Claude Code and Codex persist every session to **local JSONL transcript files** that include per-message token counts and the model used. No API, no auth, no network — this is a pure parse-and-aggregate problem against files already on disk.

- Claude Code: `~/.claude/projects/<encoded-cwd>/**/*.jsonl` (~338 files). Assistant lines carry `message.model` and `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and `~/.codex/archived_sessions/**/*.jsonl` (~208 files). Token data is in `event_msg` lines of type `token_count` (`info.total_token_usage` cumulative + `info.last_token_usage` delta); model from `turn_context.model`; session metadata from `session_meta`.

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| v1 scope | Usage + Costs + a lightweight **Top-projects** panel (single data engine — "Engine A") |
| Counting | **Deduplicated** by message id (true billed spend) |
| IA / structure | One "Usage" nav entry → left vertical tab-rail: **Overview / Costs** (mirrors Library/Settings) |
| Charts | Lightweight inline **SVG**, no charting library |
| Cache | **On-disk incremental** file index in `userData`, **no database** |
| Refresh | On view-open + a manual refresh button |
| Providers | Claude Code + Codex (the two with parseable local token data) |

**Out of scope for v1 (deferred to v2 "Engine B"):** machine-wide git/repo analytics (Repos page, Work Graph, commit activity, PRs). emdash already owns most of that data natively (`git/`, `pull-requests/`, `github/`, `skills/` domains); it is a separate effort.

---

## 2. The critical finding: deduplication

Validated against the user's real data (throwaway parser vs. Readout's own on-disk caches `~/.claude/readout-cost-cache.json`):

```
opus-4-7 cacheRead total:
  NO dedup (every transcript line) : 27.91B   (79,673 msgs)  ← matches Readout (28.8B)
  dedup by message.id              :  2.44B   ( 8,204 msgs)
```

**Readout does not deduplicate.** Claude Code copies the entire prior conversation into a new file on every resume/fork; copied messages keep their original `message.id` and original token counts. They were billed **once**. Counting every line over-counts heavily-resumed projects ~10×.

**Emdash will deduplicate by `message.id`** → true billed spend (~$3,078 all-time / 2.44B tokens for this user, vs. Readout's inflated ~$9,844 / 28.8B). The UI carries a subtle **"deduplicated"** badge so the lower-than-Readout numbers read as a correctness feature. The cost gap (~3×) is smaller than the token gap (~11×) because cache-read tokens are cheap; expensive output tokens dedup less.

Codex has no equivalent duplication (no copy-on-resume), so Codex records need no cross-file dedup.

---

## 3. Architecture

Grounded in emdash conventions (`agents/conventions/main-patterns.md`, `ipc.md`, `renderer-patterns.md`).

### 3.1 Main process — `src/main/core/usage-stats/`

Controller delegates to operations → singleton service; logic never lives inline in the controller.

```
controller.ts            createRPCController({ getSnapshot, refresh }) → returns ok(...)
                         imports: createRPCController @shared/ipc/rpc, ok @shared/result
operations.ts            getUsageSnapshot(), refreshUsage() — thin; delegate to the service
usage-stats-service.ts   singleton class; holds in-memory snapshot + file index;
                         initialize() prewarms a background scan (called from src/main/index.ts)
scanner.ts               pure: walk dirs → [{ path, mtime, size, provider }]
parse-claude.ts          pure: file text → UsageRecord[] (metadata only; never message content)
parse-codex.ts           pure: file text → UsageRecord[]
pricing.ts               pure: normalize(model)→family, RATES table, substring fallback
aggregate.ts             pure: UsageRecord[] → global dedup → UsageSnapshot
cache.ts                 load/save versioned file-index JSON in app.getPath('userData')
```

Registered in `src/main/rpc.ts`: `usageStats: usageStatsController` → renderer calls `rpc.usageStats.getSnapshot()` / `rpc.usageStats.refresh()`.

**Deliberately simpler than `resource-monitor`:** that domain needs a sampler + `setOpen` subscription because CPU/mem change every second. Usage data is static between sessions, so we omit the subscription machinery — only `getSnapshot` (cached) + `refresh` (manual).

### 3.2 Shared — `src/shared/usage.ts`

The typed IPC contract (see §5). No `any`.

### 3.3 Renderer — `src/renderer/features/usage/`

```
usage-view.tsx           WrapView (tab context synced to nav params) + UsageTitlebar + UsageMainPanel;
                         left rail [Overview | Costs] — structural clone of library-view.tsx
overview-tab.tsx         hero stats, Activity, When-you-work, Cost-by-model, Top projects, Recent
costs-tab.tsx            cost cards, cost-by-model $, monthly projection, trends, Top projects, daily cost
use-usage-snapshot.ts    React Query hook wrapping rpc.usageStats.getSnapshot + refresh mutation
format.ts                fmtTokens (1.2M), fmtUsd ($3,078)
components/
  StatCard.tsx           rounded-lg border bg-background-1, value + muted label + colored dot
  BarRow.tsx             label · track · value (width % = value / max)
  Sparkline.tsx          pure SVG bars/line in a viewBox, fluid width
  HourHistogram.tsx      pure SVG, 24 bars, "when you work"
  DedupBadge.tsx         "● deduplicated" pill
```

Wired into `src/renderer/app/view-registry.ts` (`usage: usageView`) and a "Usage" footer button in `src/renderer/features/sidebar/left-sidebar.tsx`.

---

## 4. Engine internals

### 4.1 The record (dedup unit, cached per file)

Parsers emit lightweight metadata records — never message text.

```ts
type UsageRecord = {
  id: string;                       // dedup key
  role: 'user' | 'assistant';
  provider: 'claude' | 'codex';
  ts: string;                       // ISO; bucketed to LOCAL day/hour at aggregate time
  model: string | null;            // assistant only
  cwd: string | null;
  sessionId: string;
  input: number; output: number; cacheRead: number; cacheWrite: number;
};
```

### 4.2 Parsing + dedup keys

**Claude (`parse-claude.ts`):**
- `type === 'assistant'` with `message.usage` → token record. `id = message.id` (stable across resume copies). Buckets: `input = input_tokens`, `output = output_tokens`, `cacheRead = cache_read_input_tokens`, `cacheWrite = cache_creation_input_tokens`. `model = message.model`, `cwd`, `ts`, `sessionId` from the line.
- `type === 'user'` → zero-token record with `id = uuid` (so message counts also dedup across copies).
- Malformed JSON lines are skipped, never thrown.

**Codex (`parse-codex.ts`):**
- Track current model from the latest `turn_context.payload.model`; session `cwd`/id from `session_meta`.
- `event_msg` → `token_count`: compute per-event token usage from the **delta of the monotonic `total_token_usage`** between consecutive `token_count` events, attributed to the model active at that event. (`input = inputΔ − cachedΔ`, `cacheRead = cachedΔ`, `output = outputΔ`, `cacheWrite = 0`.) Using cumulative deltas rather than raw `last_token_usage` self-corrects double counting and fixes the mid-session model-attribution skew observed in validation.
- `event_msg` → `user_message` / `agent_message` → zero-token message record (for counts).
- Codex records use synthetic unique ids (`provider:path:lineIndex`) → never collapsed by dedup.

### 4.3 Pricing (`pricing.ts`, pure, versioned)

Rates are per **million** tokens, four buckets each. `normalize(model)` matches by substring → family, so future model versions still price instead of silently costing $0:

```
/opus/        → opus     (5.0, 25.0, 0.50, 6.25)
/sonnet/      → sonnet   (3.0, 15.0, 0.30, 3.75)
/haiku/       → haiku    (1.0,  5.0, 0.10, 1.25)
/gpt-5.*mini/ → gpt5mini (0.25, 2.0, 0.025, 0.0)
/gpt-5/, /codex/ → gpt5  (1.25, 10.0, 0.125, 0.0)
else          → unknown  (rates 0; model added to snapshot.unpricedModels)

(Anthropic rates from the Readout pricing reference; OpenAI gpt-5 rates are
approximate published API rates and are the editable starting values in
`pricing.ts`. All values are reviewed once more when `pricing.ts` is written.)
```

`cost(bucket, family) = Σ (tokens / 1e6) × rate`. The table carries a `pricingUpdated` date shown in the UI. Codex cost is surfaced as an **estimate** (subscription billing is not per-token).

### 4.4 Aggregation (`aggregate.ts`, pure)

1. Gather all cached records across files.
2. **Global dedup** into `Map<id, record>` (first-wins, deterministic file order).
3. Bucket deduped records → `byModel`, `byProject` (group `cwd` → repo name; **top 8 by cost + `other` rollup**), `daily` (local date), `byHour` (length-24, token-weighted), `totals`, `windows` (**calendar-based**, local time: today / current calendar week / current calendar month-to-date / all-time), `recentSessions` (group by `sessionId`, **newest 8**).

The double-count trap is avoided because the cache stores per-file **records**, and dedup happens in aggregation — per-file incrementality and correct counting coexist.

### 4.5 Cache (`cache.ts`)

`usage-index.json` in `app.getPath('userData')`:

```ts
{ version: 1, files: { [path]: { mtime: number; size: number; records: UsageRecord[] } } }
```

Refresh: scan dirs → for each file, reuse records if `mtime`+`size` unchanged, else re-parse; drop entries for deleted files; persist index; re-aggregate all records → snapshot held in service memory. First run is a full parse (~seconds, measured); subsequent loads re-parse only changed files. A `version` bump invalidates the whole index.

---

## 5. Data contract — `src/shared/usage.ts`

```ts
type Provider = 'claude' | 'codex';

type ModelUsage = {
  model: string; provider: Provider; family: string; priced: boolean;
  input: number; output: number; cacheRead: number; cacheWrite: number;
  tokens: number; cost: number;
};

type ProjectUsage = { path: string; name: string; tokens: number; cost: number; sessions: number };
type DailyPoint   = { date: string; cost: number; tokens: number };  // local YYYY-MM-DD
type RecentSession = {
  id: string; provider: Provider; cwd: string | null; name: string;
  model: string | null; lastTs: string; messages: number; cost: number;
};

type UsageSnapshot = {
  generatedAt: string;
  pricingUpdated: string;
  totals:  { sessions: number; messages: number; tokens: number; tokensWithCache: number; cost: number };
  windows: { today: number; week: number; month: number; allTime: number };  // cost
  byModel: ModelUsage[];        // desc by cost
  byProject: ProjectUsage[];    // desc by cost, top N + 'other'
  daily: DailyPoint[];          // full history → Activity + Daily Cost
  byHour: number[];             // length 24, token-weighted → "When you work"
  recentSessions: RecentSession[];
  unpricedModels: string[];
};
```

---

## 6. Renderer behavior

- **View shell** `usage-view.tsx` clones `library-view.tsx`: `WrapView` holds tab context synced to nav params (`tab: 'overview' | 'costs'`, default `overview`); `UsageTitlebar` is `<Titlebar leftSlot="Usage">` with a refresh button; `UsageMainPanel` renders the centered `max-w-[1060px]` grid → left rail → content.
- **Data hook** `useUsageSnapshot()` wraps `useQuery(['usage','snapshot'], () => rpc.usageStats.getSnapshot())`, unwrapping `Result` (ok → data, err → error) like `resource-monitor-view`. Refresh = `useMutation(() => rpc.usageStats.refresh())` → `onSuccess` writes back via `queryClient.setQueryData(['usage','snapshot'], …)`; spinner while pending.
- **Overview tab:** hero `StatCard`s (Sessions / Messages / Tokens / Est. Cost) + `DedupBadge`; `Activity` sparkline (daily tokens); two-col `When-you-work` (`HourHistogram`) + `Cost-by-model` (`BarRow` list); `Top projects` (`BarRow`); `Recent sessions` list.
- **Costs tab:** four window cards (Today / This Week / This Month / All-Time — calendar-based, local time); cost-by-model with $; `Monthly projection` (Projected = soFar / dayOfMonth × daysInMonth, where soFar = calendar month-to-date); `Trends` — current calendar week vs the previous calendar week, and current calendar month vs the previous calendar month, as a signed %; `Top projects` by cost; `Daily Cost` bars (full history).
- **SVG primitives** are pure, dependency-free, and use emdash design tokens (`background-*`, `foreground-muted`, accent) — not Readout's hardcoded colors. Figures use `tabular-nums`. Charts expose `role="img"` + an `aria-label` text summary.
- **States** reuse existing primitives: loading → skeletons + `spinner`; empty → `empty-state.tsx` ("No Claude Code or Codex usage found yet"); error → inline message + retry.
- **Nav:** a "Usage" button in `left-sidebar.tsx` footer (lucide `Gauge`/`BarChart3`), `navigate('usage')`, active via `isCurrentView`.

---

## 7. Engineering practices

- **Pure, isolated, single-responsibility units.** `scanner`, `parse-*`, `pricing`, `aggregate` are pure functions with no I/O → trivially unit-testable with fixtures. Only `cache.ts` and the service touch the filesystem.
- **`Result<T,E>`** (`@shared/result`) for expected failures: missing directories → `ok(emptySnapshot)`; corrupt JSONL line → skipped.
- **Typed IPC contract** in `src/shared/usage.ts`; no `any`.
- **Documented + tested invariant**: global dedup means a resumed/duplicated message counts once.
- **Versioned, privacy-scoped cache**: records carry tokens/model/timestamp/cwd only — never prompt text; `version` field auto-invalidates on schema change.
- **Performance**: stream files line-by-line; re-parse only changed files.

---

## 8. Testing

- **Pure-unit tests** (vitest `node` project, colocated `*.test.ts`, small synthetic fixtures):
  - `parse-claude.test.ts` — record extraction, malformed-line skip, `message.id`/`uuid` capture.
  - `parse-codex.test.ts` — cumulative-delta attribution, `input − cached` math, mid-session model switch.
  - `pricing.test.ts` — substring fallback (`opus-4-9` prices; unknown flagged), cost arithmetic.
  - `aggregate.test.ts` — **the invariant**: an id in two files counts once; local-date windowing; by-hour/by-project bucketing.
  - `cache.test.ts` — unchanged reused, changed re-parsed, deleted dropped, version-bump invalidates.
- **Renderer**: one light test that the view renders a snapshot fixture and the empty/error states without crashing.
- **Validation harness**: formalize the throwaway parser as a dev-only check comparing aggregate totals to Readout's caches within tolerance — not in CI.
- **Merge gate** (AGENTS.md non-negotiable): `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, `pnpm test`. No DB tests (no database touched).

---

## 9. File summary

**New — main:** `src/main/core/usage-stats/{controller,operations,usage-stats-service,scanner,parse-claude,parse-codex,pricing,aggregate,cache}.ts` + colocated tests.
**New — shared:** `src/shared/usage.ts`.
**New — renderer:** `src/renderer/features/usage/{usage-view,overview-tab,costs-tab,use-usage-snapshot,format}.tsx|ts` + `components/{StatCard,BarRow,Sparkline,HourHistogram,DedupBadge}.tsx`.
**Edits:** `src/main/rpc.ts` (register controller), `src/main/index.ts` (call `usageStatsService.initialize()`), `src/renderer/app/view-registry.ts` (register view), `src/renderer/features/sidebar/left-sidebar.tsx` (nav button).

---

## 10. Known minor follow-ups

- **Codex model attribution** is approximated via cumulative-delta-by-active-model; cross-checked against Readout's codex cache during implementation, accepting small residual differences.
- **Pricing freshness**: v1 ships a bundled, dated table; a future enhancement could refresh rates remotely.
