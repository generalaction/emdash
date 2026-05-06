export function ImportProgress({ progress }: { progress: number }) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="w-full h-2 bg-background-1 rounded-full overflow-hidden">
        <div className="h-full bg-foreground rounded-full" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs text-foreground-muted text-center">{progress}%</p>
    </div>
  );
}
