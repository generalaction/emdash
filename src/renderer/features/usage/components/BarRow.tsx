export function BarRow({
  label,
  amount,
  ratio,
}: {
  label: string;
  amount: string;
  ratio: number; // 0..1
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-28 shrink-0 truncate text-xs text-foreground-muted">{label}</div>
      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-foreground/30"
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
        />
      </div>
      <div className="w-14 shrink-0 text-right text-xs text-foreground-muted tabular-nums">
        {amount}
      </div>
    </div>
  );
}
