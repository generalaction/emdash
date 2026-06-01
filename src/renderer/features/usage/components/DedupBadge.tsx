export function DedupBadge() {
  return (
    <span
      className="rounded bg-background-2 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-foreground/50 uppercase"
      title="Counts each API response once. Resumed/forked session copies are not double-counted, so totals are lower than tools that count raw transcript lines."
    >
      deduplicated
    </span>
  );
}
