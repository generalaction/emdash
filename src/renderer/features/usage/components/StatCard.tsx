export function StatCard({ value, label, dot }: { value: string; label: string; dot?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3">
      <div className="text-xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-foreground-muted">
        {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
    </div>
  );
}
