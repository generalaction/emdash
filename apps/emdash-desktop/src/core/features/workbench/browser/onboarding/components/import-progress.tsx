export function ImportProgress({ progress }: { progress: number }) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-background-1">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-center text-xs text-foreground-muted">{progress}%</p>
    </div>
  );
}
