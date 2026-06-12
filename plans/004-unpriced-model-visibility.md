# Plan 004: Surface unpriced models instead of silently costing them $0

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ecb2a2125..HEAD -- src/shared/usage.ts src/main/core/usage-stats/aggregate.ts src/main/core/usage-stats/aggregate.test.ts src/renderer/features/usage/components/Panel.tsx src/renderer/features/usage/overview-tab.tsx src/renderer/features/usage/costs-tab.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive snapshot fields; one renderer filter change)
- **Depends on**: none
- **Category**: bug (UX-correctness)
- **Planned at**: commit `ecb2a2125`, 2026-06-11

## Why this matters

When a model has no rate — not in the models.dev table and not matching a bundled family
(opus/sonnet/haiku/gpt-5/codex) — `costOf` returns `0`. Its tokens still count in the
headline "Tokens" stat, but the model row is filtered out of "Cost by model"
(`m.cost > 0`) and contributes $0 everywhere. The user sees totals and per-model lists
that quietly disagree, with no hint why. `isPriced()` in `pricing.ts` was written for
exactly this and is currently dead code (only its own tests call it). After this plan,
unpriced models appear in the list with a "—" amount, and a muted footnote reports how
many tokens were excluded from cost totals.

## Current state

- `src/main/core/usage-stats/pricing.ts:63` — the dead helper to wire up:

```ts
export function isPriced(vendor: string, model: string): boolean {
  return rateForModel(vendor, model) !== null;
}
```

- `src/main/core/usage-stats/aggregate.ts` — per-record loop. Cost + totals
  (lines 65–79):

```ts
  for (const r of records) {
    const buckets = { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite };
    const cost = r.model ? costOf(buckets, r.vendor, r.model) : 0;
    const tokens = r.input + r.output;

    totals.tokens += tokens;
    totals.cost += cost;
```

  and the by-model bucket init (lines 82–92):

```ts
    if (r.model) {
      const mu = models.get(r.model) ?? {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        model: r.model, provider: r.provider, tokens: 0, cost: 0,
      };
```

- `src/shared/usage.ts` — `UsageTotals` (lines 40–45), `ModelUsage` (lines 13–18), and
  `EMPTY_USAGE_SNAPSHOT` (lines 58–67). All three change additively.
- `src/renderer/features/usage/components/Panel.tsx` — `CostByModel` (lines 30–41):

```ts
export function CostByModel({ byModel }: { byModel: ModelUsage[] }) {
  const max = Math.max(1, ...byModel.map((m) => m.cost));
  return (
    <Panel title="Cost by model">
      {byModel
        .filter((m) => m.cost > 0)
        .map((m) => (
          <BarRow key={m.model} label={m.model} amount={fmtUsd(m.cost)} ratio={m.cost / max} />
        ))}
    </Panel>
  );
}
```

- Callers of `CostByModel`: `overview-tab.tsx:29` and `costs-tab.tsx:26` — both have
  `snapshot` in scope.
- `src/renderer/features/usage/format.ts` — `fmtTokens` / `fmtUsd` helpers.
- `src/main/core/usage-stats/aggregate.test.ts` — existing tests use a `rec(over)`
  factory; one test already asserts "mystery-model" costs $0
  ("buckets cost by model, pricing only known models"). Extend that file.
- Pricing module state: tests run with no remote rates installed (bundled family
  fallback only), so `vendor: 'meta', model: 'llama-3'` is unpriced and
  `vendor: 'anthropic', model: 'claude-opus-4-8'` is priced. If any test in the file
  calls `setRemoteRates`, it must reset with `setRemoteRates(new Map())` afterward.
- `CACHE_VERSION` in `cache.ts` does NOT change: `UsageRecord` (the persisted shape) is
  untouched; only the derived `UsageSnapshot` grows fields, and snapshots are never persisted.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Typecheck | `pnpm run typecheck`                                      | exit 0              |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass            |
| Lint      | `pnpm run lint`                                           | exit 0              |
| Format    | `pnpm run format`                                         | exit 0              |

## Scope

**In scope** (the only files you may modify):
- `src/shared/usage.ts`
- `src/main/core/usage-stats/aggregate.ts`
- `src/main/core/usage-stats/aggregate.test.ts`
- `src/renderer/features/usage/components/Panel.tsx`
- `src/renderer/features/usage/overview-tab.tsx`
- `src/renderer/features/usage/costs-tab.tsx`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `pricing.ts` — `isPriced` already exists and is correct; just call it.
- `cache.ts` / `CACHE_VERSION` — persisted record shape unchanged.
- Adding new rates or family patterns — that's a data problem, not this plan.
- `StatCard`/overview stat grid layout — the footnote lives inside the CostByModel panel.

## Git workflow

- Work on the current branch (`stats-4ahru`).
- One commit, e.g.: `fix(usage-stats): surface unpriced models instead of hiding them at $0`
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Extend the shared types

In `src/shared/usage.ts`:
- Add to `ModelUsage`: `priced: boolean; // false when no rate was found — cost is 0 and meaningless`
- Add to `UsageTotals`: `unpricedTokens: number; // input+output tokens excluded from cost because their model had no rate`
- Update `EMPTY_USAGE_SNAPSHOT.totals` with `unpricedTokens: 0`.

**Verify**: `pnpm run typecheck` → FAILS in `aggregate.ts` (missing fields) — expected;
fixed next step. Note every other failure location it reports; they all must be in
in-scope files (see STOP conditions).

### Step 2: Compute the new fields in aggregate

In `aggregate.ts`:
- Import `isPriced` alongside `costOf` from `./pricing`.
- In the per-record loop, after `cost` is computed:

```ts
    const priced = r.model ? isPriced(r.vendor, r.model) : false;
    if (r.model && !priced) totals.unpricedTokens += tokens;
```

- Initialize `totals` with `unpricedTokens: 0`.
- In the by-model bucket: initialize `priced: false` in the `??` default, and after the
  bucket updates add `mu.priced = mu.priced || priced;` (a model counts as priced if any
  of its records priced — mirrors how cost accrues).

**Verify**: `pnpm run typecheck` → exit 0.

### Step 3: Renderer — show unpriced rows and the footnote

In `Panel.tsx`, change `CostByModel` to accept and render the new data:

```tsx
export function CostByModel({
  byModel,
  unpricedTokens,
}: {
  byModel: ModelUsage[];
  unpricedTokens: number;
}) {
  const max = Math.max(1, ...byModel.map((m) => m.cost));
  return (
    <Panel title="Cost by model">
      {byModel
        .filter((m) => m.cost > 0 || !m.priced)
        .map((m) => (
          <BarRow
            key={m.model}
            label={m.model}
            amount={m.priced ? fmtUsd(m.cost) : '—'}
            ratio={m.cost / max}
          />
        ))}
      {unpricedTokens > 0 ? (
        <div className="mt-2 text-[10px] text-foreground/40">
          {fmtTokens(unpricedTokens)} tokens from models without known rates are excluded
          from cost totals.
        </div>
      ) : null}
    </Panel>
  );
}
```

Import `fmtTokens` from `../format` (already exports it). Update both call sites to pass
the prop: `<CostByModel byModel={byModel} unpricedTokens={snapshot.totals.unpricedTokens} />`
in `overview-tab.tsx` (destructure stays as is; `snapshot` is the prop) and
`costs-tab.tsx`.

**Verify**: `pnpm run typecheck` → exit 0.

### Step 4: Tests

In `aggregate.test.ts`, add one test (reuse the `rec` factory):

```ts
  it('tracks unpriced tokens and flags unpriced models instead of hiding them', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1000, output: 500, vendor: 'anthropic', model: 'claude-opus-4-8' }),
        rec({ id: 'b', input: 200, output: 100, vendor: 'meta', model: 'llama-3' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.totals.unpricedTokens).toBe(300);
    expect(snap.byModel.find((m) => m.model === 'llama-3')?.priced).toBe(false);
    expect(snap.byModel.find((m) => m.model === 'claude-opus-4-8')?.priced).toBe(true);
  });
```

Also check whether the existing "mystery-model" test or any other test constructs
`ModelUsage` literals that now need the `priced` field — fix compile errors within
in-scope files only.

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/` → all pass.

### Step 5: Full gate

**Verify**: `pnpm run lint` → exit 0; `pnpm run format` → exit 0;
`pnpm run typecheck` → exit 0 (re-run last; the renderer is typechecked by the same
root tsconfig).

## Test plan

- One new aggregate test (Step 4) covering both new fields.
- No renderer test: `CostByModel` is presentational; the repo's renderer unit tests
  (`src/renderer/tests/`) don't currently cover the usage feature, and a browser-project
  test for a footnote string is not worth the harness cost. Typecheck covers the wiring.

## Done criteria

ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm vitest run --project node src/main/core/usage-stats/` exits 0, including the new unpriced test
- [ ] `grep -n "isPriced" src/main/core/usage-stats/aggregate.ts` returns a match (dead code revived)
- [ ] `grep -n "unpricedTokens" src/shared/usage.ts src/renderer/features/usage/components/Panel.tsx` returns matches in both
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's typecheck failures include files outside the in-scope list (something else
  constructs `UsageTotals`/`ModelUsage` literals this plan didn't anticipate).
- `CostByModel` in the live file doesn't match the "Current state" excerpt.
- You're tempted to bump `CACHE_VERSION` — that means you changed `UsageRecord`, which
  is out of scope; back out and re-read Step 2.

## Maintenance notes

- A model is flagged `priced` if ANY of its records priced — if per-vendor splits are
  ever added to `byModel`, revisit this OR-fold.
- Models.dev lists some genuinely free models (rate 0); those are `priced: true` with
  cost $0 and are correctly hidden by `cost > 0 || !priced` only if... they are hidden.
  That's the pre-existing behavior for $0-cost priced models; acceptable, but a reviewer
  may want a product opinion here.
- Follow-up deliberately deferred: surfacing WHICH vendors/models are unpriced in a
  tooltip (needs design input), and telemetry on unpriced share.
