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
