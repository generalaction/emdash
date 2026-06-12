# Plan 005: Show a toast when the manual usage refresh fails

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ecb2a2125..HEAD -- src/renderer/features/usage/use-usage-snapshot.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UX)
- **Planned at**: commit `ecb2a2125`, 2026-06-11

## Why this matters

The refresh button in the Usage panel runs a react-query mutation whose errors are
silently discarded: the user clicks refresh, the spinner stops, and nothing indicates the
refresh failed — the stale data just sits there looking current. One `onError` handler
with the repo's standard toast fixes it.

## Current state

- `src/renderer/features/usage/use-usage-snapshot.ts` — the whole hook (33 lines). The
  mutation today (lines 17–23):

```ts
  const refresh = useMutation({
    mutationFn: async () => {
      const res = await rpc.usageStats.refresh();
      return res.data;
    },
    onSuccess: (snapshot) => queryClient.setQueryData(KEY, snapshot),
  });
```

- Toast convention: `useToast` from `@renderer/lib/hooks/use-toast`, destructured as
  `const { toast } = useToast();`, called with
  `toast({ title, description, variant: 'destructive' })` for errors. Exemplar:
  `src/renderer/features/settings/components/AccountTab.tsx:3,19,35-39`. Match it.
- The hook is called from `src/renderer/features/usage/usage-panel.tsx:22` — no caller
  changes needed.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|---------------------|
| Typecheck | `pnpm run typecheck`  | exit 0              |
| Lint      | `pnpm run lint`       | exit 0              |
| Format    | `pnpm run format`     | exit 0              |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass (unchanged) |

## Scope

**In scope** (the only files you may modify):
- `src/renderer/features/usage/use-usage-snapshot.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `usage-panel.tsx` — no inline error state needed; the toast is the repo convention.
- The query's error path (`isError` → EmptyState) — already handled in the panel.
- Retry logic, optimistic updates — not requested, no evidence needed.

## Git workflow

- Work on the current branch (`stats-4ahru`).
- One commit, e.g.: `fix(usage-stats): toast on failed manual refresh instead of silent no-op`
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the onError toast

In `use-usage-snapshot.ts`:
- `import { useToast } from '@renderer/lib/hooks/use-toast';`
- Inside `useUsageSnapshot`, before the mutation: `const { toast } = useToast();`
- Add to the `useMutation` options:

```ts
    onError: (error) =>
      toast({
        title: 'Refresh failed',
        description: error instanceof Error ? error.message : 'Could not refresh usage data.',
        variant: 'destructive',
      }),
```

**Verify**: `pnpm run typecheck` → exit 0.

### Step 2: Full gate

**Verify**: `pnpm run lint` → exit 0; `pnpm run format` → exit 0.

Optional manual check (if the operator wants it): `pnpm run d`, open Settings → Usage,
temporarily disconnect nothing — skip destructive simulation; the typed wiring is enough.

## Test plan

None — a toast call inside a hook is below the repo's renderer-test waterline (no
existing tests cover this feature's hooks), and the typecheck verifies the wiring.
If a reviewer disagrees, the right harness is a browser-project test under
`src/renderer/tests/browser/`; note it as follow-up rather than building it here.

## Done criteria

ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm run lint` exits 0
- [ ] `grep -n "onError" src/renderer/features/usage/use-usage-snapshot.ts` returns a match
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `@renderer/lib/hooks/use-toast` doesn't exist or exports a different shape than the
  AccountTab exemplar shows.
- The mutation in the live file doesn't match the "Current state" excerpt.

## Maintenance notes

- If plan 001's background TTL refresh ever surfaces errors to the renderer, reuse this
  toast copy for consistency.
