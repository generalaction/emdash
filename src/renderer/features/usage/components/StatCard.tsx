export function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3">
      <div className="text-xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-foreground-muted">{label}</div>
    </div>
  );
}
