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
        <div
          className="h-full rounded"
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, background: color }}
        />
      </div>
      <div className="w-14 shrink-0 text-right text-xs text-foreground-muted tabular-nums">
        {amount}
      </div>
    </div>
  );
}
