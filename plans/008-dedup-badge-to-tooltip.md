# Plan 008: Replace the always-on DEDUPLICATED badge with an info tooltip on the Tokens stat

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (presentational only)
- **Depends on**: none (applies on top of `3aa4a4dac`)
- **Category**: UX
- **Planned at**: commit `3aa4a4dac`, 2026-06-12

## Why this matters

The Usage panel header shows a permanent all-caps "DEDUPLICATED" chip. It explains an
internal implementation detail (resumed/forked sessions copy messages; emdash counts each
API response once, so totals run lower than naive line-counting tools). The message is
worth keeping, but a permanently visible badge is the wrong vehicle: it shows regardless
of whether anything was deduplicated and visually outranks the data it footnotes. Move the
explanation into an `Info`-icon tooltip on the "Tokens" stat card and delete the badge.

## Current state

- `src/renderer/features/usage/components/DedupBadge.tsx` — the whole component (to be
  deleted). Its tooltip copy (to be reused, lightly trimmed):
  "Each API response is counted once. When you resume or fork a session, the earlier
  messages get copied into the new transcript — those copies aren't counted again, so
  totals are lower (and truer) than tools that count every transcript line."
- `src/renderer/features/usage/usage-panel.tsx` — imports `DedupBadge` (line 8) and
  renders `<DedupBadge />` inside the header's right-hand `div` (line 77), next to the
  refresh button.
- `src/renderer/features/usage/components/StatCard.tsx` — currently:

```tsx
export function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3">
      <div className="text-xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-foreground-muted">{label}</div>
    </div>
  );
}
```

- `src/renderer/features/usage/overview-tab.tsx` — renders
  `<StatCard value={fmtTokens(totals.tokens)} label="Tokens" />` in the stat grid.
- Tooltip primitive: `Tooltip, TooltipContent, TooltipTrigger` from
  `@renderer/lib/ui/tooltip`; `Info` icon from `lucide-react` — both exactly as
  `DedupBadge.tsx` uses them today. `TooltipContent` accepts `className="max-w-xs"`.

## Commands

| Purpose   | Command               | Expected |
|-----------|------------------------|----------|
| Install   | `pnpm install`         | exit 0   |
| Typecheck | `pnpm run typecheck`   | exit 0   |
| Lint      | `pnpm run lint`        | exit 0   |
| Format    | `pnpm run format`      | exit 0   |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | 56 pass (unchanged) |

## Scope

**In scope** (only these):
- `src/renderer/features/usage/components/StatCard.tsx`
- `src/renderer/features/usage/overview-tab.tsx`
- `src/renderer/features/usage/usage-panel.tsx`
- `src/renderer/features/usage/components/DedupBadge.tsx` (DELETE)

**Out of scope**: `costs-tab.tsx` (its StatCards get no hint), everything in
`src/main/`, `TaskCostBadge`, the unpriced-models footnote.

## Git workflow

- One commit: `refactor(usage-stats): replace always-on dedup badge with Tokens stat tooltip`
- Do NOT push.

## Steps

### Step 1: Extend StatCard with an optional hint

```tsx
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function StatCard({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3">
      <div className="text-xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-foreground-muted">
        {label}
        {hint ? (
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-foreground/40" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
```

**Verify**: `pnpm run typecheck` → exit 0 (prop is optional; no caller changes required yet).

### Step 2: Pass the hint on the Tokens card

In `overview-tab.tsx`, change the Tokens StatCard to:

```tsx
        <StatCard
          value={fmtTokens(totals.tokens)}
          label="Tokens"
          hint="Each API response is counted once — when you resume or fork a session, the copied earlier messages aren't counted again, so totals run lower (and truer) than tools that count every transcript line."
        />
```

**Verify**: `pnpm run typecheck` → exit 0.

### Step 3: Remove the badge

- In `usage-panel.tsx`: delete the `DedupBadge` import and the `<DedupBadge />` element
  (keep the surrounding `div` and refresh button untouched).
- Delete the file `src/renderer/features/usage/components/DedupBadge.tsx` (`git rm`).

**Verify**: `pnpm run typecheck` → exit 0;
`grep -rn "DedupBadge" src/` → no matches.

### Step 4: Full gate

**Verify**: `pnpm run lint` → exit 0; `pnpm run format` → exit 0;
`pnpm vitest run --project node src/main/core/usage-stats/` → 56 pass.

## Done criteria

- [ ] `pnpm run typecheck` exits 0
- [ ] `grep -rn "DedupBadge" src/` returns no matches; the file is deleted
- [ ] `grep -n "hint" src/renderer/features/usage/components/StatCard.tsx src/renderer/features/usage/overview-tab.tsx` matches in both
- [ ] `pnpm vitest run --project node src/main/core/usage-stats/` exits 0 (56 tests)
- [ ] `git status` clean outside the in-scope list

## STOP conditions

- `usage-panel.tsx` header or `StatCard.tsx` don't match the excerpts above.
- Any other file imports `DedupBadge` (grep first; only `usage-panel.tsx` should).

## Maintenance notes

- `hint` is generic — the "Est. Cost" card can reuse it later (e.g. for the unpriced-models
  caveat) without further StatCard changes.
